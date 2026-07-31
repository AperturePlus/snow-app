import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { useI18n } from "../../i18n";
import { getFileTypeIcon } from "../../utils/fileIcons";
import type { CodebaseFileEmbedding } from "../../../preload";

// 布局计算为 O(n²)，提供数量阈值选项让用户权衡完整度与等待时间。
const LIMIT_OPTIONS = [300, 500, 700] as const;
type NodeLimit = "all" | (typeof LIMIT_OPTIONS)[number];
// Rust 端 get_codebase_file_embeddings 的硬上限。
const MAX_API_LIMIT = 2000;
const SPHERE_RADIUS = 1.0;
const LAYOUT_ITERATIONS = 300;
// 悬停时高亮的最相似文件数量与最低相似度阈值。
const RELATED_COUNT = 8;
const RELATED_MIN_SIM = 0.2;

type SphereNode = {
  index: number;
  path: string;
  chunkCount: number;
  startLine: number;
  endLine: number;
  sizeBytes: number;
  x: number;
  y: number;
  z: number;
};

type SphereEdge = {
  a: number;
  b: number;
  similarity: number;
};

type TooltipData = {
  x: number;
  y: number;
  node: SphereNode;
  neighbors: { path: string; similarity: number }[];
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getBaseName = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const cosineSimilarity = (a: number[], b: number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  // Clamp: floating point rounding can push the ratio slightly beyond [-1, 1],
  // which would otherwise break Math.pow(1 - sim, ...) below (NaN).
  const raw = dot / Math.sqrt(normA * normB);
  return Math.max(-1, Math.min(1, raw));
};

const buildSimilarityMatrix = (files: CodebaseFileEmbedding[]): number[][] => {
  const n = files.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = cosineSimilarity(files[i].embedding, files[j].embedding);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }
  return sim;
};

// 每个节点连接相似度最高的两个邻居（无向去重），构成真实相似度关系网。
const buildEdges = (n: number, sim: number[][]): SphereEdge[] => {
  const edges: SphereEdge[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const ranked: { j: number; s: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) {
        continue;
      }
      ranked.push({ j, s: sim[i][j] });
    }
    ranked.sort((a, b) => b.s - a.s);
    for (const { j, s } of ranked.slice(0, 2)) {
      if (s < 0.25) {
        continue;
      }
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      edges.push({ a: i, b: j, similarity: s });
    }
  }
  return edges;
};

// 3D 力导向布局：以真实余弦相似度映射为弹簧目标距离，相似文件聚拢、
// 不相似文件远离，形成离散的球形关系图。
const runForceLayout = (nodes: SphereNode[], sim: number[][]): void => {
  const n = nodes.length;
  const R = SPHERE_RADIUS;

  // 初始位置：均匀分布在球面上（带少量径向扰动）。
  for (const node of nodes) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = R * (0.92 + 0.08 * Math.random());
    node.x = r * Math.sin(phi) * Math.cos(theta);
    node.y = r * Math.sin(phi) * Math.sin(theta);
    node.z = r * Math.cos(phi);
  }

  const force = new Float64Array(n * 3);
  const springK = 0.14;
  const repulsionK = 0.11;
  const centeringK = 0.03;
  let alpha = 1;

  for (let iter = 0; iter < LAYOUT_ITERATIONS; iter++) {
    force.fill(0);

    for (let i = 0; i < n; i++) {
      const ax = nodes[i].x;
      const ay = nodes[i].y;
      const az = nodes[i].z;
      for (let j = i + 1; j < n; j++) {
        let dx = ax - nodes[j].x;
        let dy = ay - nodes[j].y;
        let dz = az - nodes[j].z;
        let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-6) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          dz = Math.random() - 0.5;
          d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-3;
        }

        // 相似度越高目标距离越近；低相似文件被推到球体边缘。
        const target = Math.min(
          1.5 * R,
          Math.max(
            0.12 * R,
            R * Math.pow(Math.max(0, 1 - sim[i][j]), 1.4) * 0.62
          )
        );
        const spring = (target - d) * springK * alpha;
        const fx = (spring * dx) / d;
        const fy = (spring * dy) / d;
        const fz = (spring * dz) / d;
        force[i * 3] += fx;
        force[i * 3 + 1] += fy;
        force[i * 3 + 2] += fz;
        force[j * 3] -= fx;
        force[j * 3 + 1] -= fy;
        force[j * 3 + 2] -= fz;

        // 全局排斥，让簇与簇之间保持间隙（离散感）。
        const rep = (repulsionK * alpha) / (d * d + 0.001);
        const rx = (rep * dx) / d;
        const ry = (rep * dy) / d;
        const rz = (rep * dz) / d;
        force[i * 3] += rx;
        force[i * 3 + 1] += ry;
        force[i * 3 + 2] += rz;
        force[j * 3] -= rx;
        force[j * 3 + 1] -= ry;
        force[j * 3 + 2] -= rz;
      }
    }

    for (let i = 0; i < n; i++) {
      nodes[i].x += force[i * 3];
      nodes[i].y += force[i * 3 + 1];
      nodes[i].z += force[i * 3 + 2];
      const pull = 1 - centeringK * alpha;
      nodes[i].x *= pull;
      nodes[i].y *= pull;
      nodes[i].z *= pull;
    }

    alpha *= 0.987;
  }

  // 防御：任何坐标非有限值（NaN/Infinity）的节点重置为球面随机点，
  // 避免污染后续的几何数据。
  for (const node of nodes) {
    if (
      !Number.isFinite(node.x) ||
      !Number.isFinite(node.y) ||
      !Number.isFinite(node.z)
    ) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      node.x = R * Math.sin(phi) * Math.cos(theta);
      node.y = R * Math.sin(phi) * Math.sin(theta);
      node.z = R * Math.cos(phi);
    }
  }

  // 整体缩放，让散点始终铺满球体空间（保持离散球形态）。
  let maxNorm = 0;
  for (const node of nodes) {
    const norm = Math.hypot(node.x, node.y, node.z);
    if (norm > maxNorm) {
      maxNorm = norm;
    }
  }
  if (maxNorm > 0.05 * R) {
    const scale = R / maxNorm;
    for (const node of nodes) {
      node.x *= scale;
      node.y *= scale;
      node.z *= scale;
    }
  }
};

type CodebaseSphereViewProps = {
  projectId: string;
};

/**
 * 场景对外暴露的操作接口：搜索高亮、相机聚焦、按关键字查找节点。
 */
type SphereSceneApi = {
  highlight: (index: number | null) => void;
  focus: (index: number) => void;
  findIndex: (query: string) => number;
  dispose: () => void;
};

/**
 * 3D 相似度关系图：每个点代表一个已索引文件，点间距离由真实 embedding
 * 余弦相似度驱动（力导向布局），连线为最近邻相似关系。支持拖拽旋转，
 * 悬停散点查看文件信息并高亮其关系连线。
 */
export const CodebaseSphereView = ({
  projectId,
}: CodebaseSphereViewProps): React.JSX.Element => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "error" | "empty" | "ready">(
    "loading"
  );
  const [nodeLimit, setNodeLimit] = useState<NodeLimit>("all");
  const [shownCount, setShownCount] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [query, setQuery] = useState("");
  const [hasMatch, setHasMatch] = useState(true);
  const sceneApiRef = useRef<SphereSceneApi | null>(null);
  const queryRef = useRef("");

  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) {
      return;
    }

    setState("loading");

    void (async () => {
      try {
        // 先取索引统计确定总文件数，再决定拉取范围，保证与表格数量一致。
        const stats = await window.snow.getCodebaseIndexStats(projectId);
        if (disposed) {
          return;
        }
        const total = stats.totalFiles;
        setTotalFiles(total);
        // “全部”时尽量全量（受后端硬上限保护）；否则按用户选择截断。
        const limit =
          nodeLimit === "all"
            ? Math.max(1, Math.min(total, MAX_API_LIMIT))
            : Math.max(1, Math.min(total, nodeLimit));
        const files = await window.snow.getCodebaseFileEmbeddings(
          projectId,
          limit
        );
        if (disposed) {
          return;
        }
        if (files.length === 0) {
          setState("empty");
          return;
        }
        setShownCount(files.length);
        // 先让 loading 帧渲染，再同步计算布局与构建场景。
        requestAnimationFrame(() => {
          if (disposed) {
            return;
          }
          try {
            sceneApiRef.current = setupScene(files);
            setState("ready");
            // 场景（重建）就绪后，重新应用搜索状态。
            const pendingQuery = queryRef.current.trim();
            if (pendingQuery) {
              const pendingIndex =
                sceneApiRef.current?.findIndex(pendingQuery) ?? -1;
              setHasMatch(pendingIndex >= 0);
              if (pendingIndex >= 0) {
                sceneApiRef.current?.highlight(pendingIndex);
                sceneApiRef.current?.focus(pendingIndex);
              }
            }
          } catch {
            setState("error");
          }
        });
      } catch {
        if (!disposed) {
          setState("error");
        }
      }
    })();

    function setupScene(files: CodebaseFileEmbedding[]): () => void {
      const nodes: SphereNode[] = files.map((file, index) => ({
        index,
        path: file.relativePath,
        chunkCount: file.chunkCount,
        startLine: file.startLine,
        endLine: file.endLine,
        sizeBytes: file.sizeBytes,
        x: 0,
        y: 0,
        z: 0,
      }));
      const sim = buildSimilarityMatrix(files);
      runForceLayout(nodes, sim);
      const edges = buildEdges(nodes.length, sim);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        50,
        container.clientWidth / Math.max(1, container.clientHeight),
        0.1,
        100
      );
      // 拉远相机，让球体默认尺寸约为原来的一半。
      camera.position.set(0, 0.5, 4.2);
      camera.lookAt(0, 0, 0);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      container.appendChild(renderer.domElement);

      // 手动拖拽旋转，不自转。
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.rotateSpeed = 0.9;
      controls.enablePan = false;
      controls.minDistance = 2.2;
      controls.maxDistance = 8;

      // 相似度连线（最近邻边），低透明度打底。
      const linePositions: number[] = [];
      edges.forEach((edge) => {
        const na = nodes[edge.a];
        const nb = nodes[edge.b];
        linePositions.push(na.x, na.y, na.z, nb.x, nb.y, nb.z);
      });
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(linePositions, 3)
      );
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x60a5fa,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
      scene.add(lines);

      // 悬停高亮连线（动态更新）。
      const hoverLineGeometry = new THREE.BufferGeometry();
      hoverLineGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute([], 3)
      );
      const hoverLines = new THREE.LineSegments(
        hoverLineGeometry,
        new THREE.LineBasicMaterial({
          color: 0x93c5fd,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        })
      );
      hoverLines.visible = false;
      scene.add(hoverLines);

      // 文件节点：视觉小球 + 不可见的较大命中球（保证悬停易命中）。
      const hitMeshes: THREE.Mesh[] = [];
      const meshToIndex = new Map<THREE.Mesh, number>();
      const nodeMeshes: THREE.Mesh[] = [];
      nodes.forEach((node) => {
        const visualSize =
          0.022 + Math.min(0.02, Math.log2(node.chunkCount + 1) * 0.005);
        const color = new THREE.Color().setHSL(
          0.55 + 0.09 * Math.min(1, node.chunkCount / 30),
          0.85,
          0.62
        );
        const visual = new THREE.Mesh(
          new THREE.SphereGeometry(visualSize, 16, 12),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
          })
        );
        visual.position.set(node.x, node.y, node.z);
        scene.add(visual);
        nodeMeshes.push(visual);

        const hit = new THREE.Mesh(
          new THREE.SphereGeometry(0.09, 8, 6),
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          })
        );
        hit.position.set(node.x, node.y, node.z);
        scene.add(hit);
        hitMeshes.push(hit);
        meshToIndex.set(hit, node.index);
      });

      // 悬停检测。
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let hoveredIndex: number | null = null;
      let isDragging = false;
      // 搜索激活的节点索引：非 null 时悬停高亮被锁定，避免互相覆盖。
      let searchActiveIndex: number | null = null;
      let focusRafId = 0;

      const getNeighbors = (
        index: number
      ): { path: string; similarity: number }[] =>
        edges
          .filter((edge) => edge.a === index || edge.b === index)
          .map((edge) => ({
            path: edge.a === index ? nodes[edge.b].path : nodes[edge.a].path,
            similarity: edge.similarity,
          }))
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 3);

      // 悬停时高亮悬停点本身 + 与其最相似的一批文件，其余节点变暗，
      // 形成“以一点为中心的关系聚焦”效果。
      const getRelatedSet = (index: number): Set<number> => {
        const ranked: { j: number; s: number }[] = [];
        for (let j = 0; j < sim.length; j++) {
          if (j === index) {
            continue;
          }
          ranked.push({ j, s: sim[index][j] });
        }
        ranked.sort((a, b) => b.s - a.s);
        const related = new Set<number>();
        for (const { j, s } of ranked.slice(0, RELATED_COUNT)) {
          if (s >= RELATED_MIN_SIM) {
            related.add(j);
          }
        }
        return related;
      };

      const applyHoverHighlight = (index: number | null): void => {
        const related = index !== null ? getRelatedSet(index) : null;

        nodeMeshes.forEach((mesh, i) => {
          const material = mesh.material as THREE.MeshBasicMaterial;
          const isHovered = i === index;
          const isRelated = related?.has(i) ?? false;
          if (isHovered) {
            mesh.scale.setScalar(2.4);
            material.color.set(0xdbeafe);
            material.opacity = 1;
          } else if (isRelated) {
            mesh.scale.setScalar(1.55);
            material.color.set(0x7dd3fc);
            material.opacity = 1;
          } else {
            mesh.scale.setScalar(0.8);
            material.color.set(0x64748b);
            material.opacity = 0.35;
          }
        });

        lineMaterial.opacity = index === null ? 0.16 : 0.05;

        if (index === null) {
          hoverLines.visible = false;
          return;
        }
        // 高亮悬停点到最相似文件的连线。
        const positions: number[] = [];
        edges.forEach((edge) => {
          if (edge.a !== index && edge.b !== index) {
            return;
          }
          const otherIndex = edge.a === index ? edge.b : edge.a;
          if (!related?.has(otherIndex)) {
            return;
          }
          const other = nodes[otherIndex];
          positions.push(
            nodes[index].x,
            nodes[index].y,
            nodes[index].z,
            other.x,
            other.y,
            other.z
          );
        });
        if (positions.length > 0) {
          hoverLineGeometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(positions, 3)
          );
          hoverLineGeometry.computeBoundingSphere();
          hoverLines.visible = true;
        } else {
          hoverLines.visible = false;
        }
      };

      const onPointerDown = (): void => {
        isDragging = true;
      };

      const onPointerUp = (): void => {
        isDragging = false;
      };

      const onPointerMove = (event: PointerEvent): void => {
        if (isDragging || searchActiveIndex !== null) {
          return;
        }
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(hitMeshes, false);
        if (hits.length > 0) {
          const index = meshToIndex.get(hits[0].object) ?? null;
          if (index !== hoveredIndex) {
            hoveredIndex = index;
            applyHoverHighlight(index);
          }
          if (index !== null) {
            const node = nodes[index];
            const neighbors = getNeighbors(index);
            const tooltipX = Math.max(
              8,
              Math.min(event.clientX - rect.left + 14, rect.width - 296)
            );
            const tooltipY = Math.max(
              8,
              Math.min(event.clientY - rect.top + 14, rect.height - 220)
            );
            setTooltip({ x: tooltipX, y: tooltipY, node, neighbors });
          }
        } else {
          if (hoveredIndex !== null) {
            hoveredIndex = null;
            applyHoverHighlight(null);
          }
          setTooltip(null);
        }
      };

      const onPointerLeave = (): void => {
        hoveredIndex = null;
        applyHoverHighlight(null);
        setTooltip(null);
      };

      // 搜索高亮：锁定悬停，聚焦目标节点及其最相似文件群组。
      const searchHighlight = (index: number | null): void => {
        searchActiveIndex = index;
        applyHoverHighlight(index);
        if (index === null) {
          setTooltip(null);
          return;
        }
        const node = nodes[index];
        setTooltip({
          x: 12,
          y: 36,
          node,
          neighbors: getNeighbors(index),
        });
      };

      // 按关键字（不区分大小写）查找第一个匹配的文件路径。
      const findIndex = (q: string): number => {
        const lower = q.toLowerCase();
        return nodes.findIndex((node) =>
          node.path.toLowerCase().includes(lower)
        );
      };

      // 平滑聚焦到目标节点：平移 controls.target 与相机，保持相对视角。
      const focus = (index: number): void => {
        cancelAnimationFrame(focusRafId);
        const node = nodes[index];
        const startTarget = controls.target.clone();
        const endTarget = new THREE.Vector3(node.x, node.y, node.z);
        const offset = new THREE.Vector3()
          .copy(camera.position)
          .sub(controls.target);
        const startPos = camera.position.clone();
        const endPos = endTarget.clone().add(offset);
        const duration = 450;
        const startTime = performance.now();
        const step = (): void => {
          const t = Math.min(1, (performance.now() - startTime) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          controls.target.lerpVectors(startTarget, endTarget, eased);
          camera.position.lerpVectors(startPos, endPos, eased);
          camera.lookAt(controls.target);
          if (t < 1) {
            focusRafId = requestAnimationFrame(step);
          }
        };
        focusRafId = requestAnimationFrame(step);
      };

      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      renderer.domElement.addEventListener("pointerup", onPointerUp);
      renderer.domElement.addEventListener("pointermove", onPointerMove);
      renderer.domElement.addEventListener("pointerleave", onPointerLeave);

      const onResize = (): void => {
        const width = container.clientWidth;
        const height = Math.max(1, container.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };
      const resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(container);

      let rafId = 0;
      const animate = (): void => {
        controls.update();
        renderer.render(scene, camera);
        rafId = requestAnimationFrame(animate);
      };
      animate();

      return {
        highlight: searchHighlight,
        focus,
        findIndex,
        dispose: () => {
          cancelAnimationFrame(rafId);
          cancelAnimationFrame(focusRafId);
          resizeObserver.disconnect();
          renderer.domElement.removeEventListener("pointerdown", onPointerDown);
          renderer.domElement.removeEventListener("pointerup", onPointerUp);
          renderer.domElement.removeEventListener("pointermove", onPointerMove);
          renderer.domElement.removeEventListener(
            "pointerleave",
            onPointerLeave
          );
          controls.dispose();
          scene.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (mesh.geometry) {
              mesh.geometry.dispose();
            }
            const material =
              mesh.material as THREE.Material | THREE.Material[];
            if (Array.isArray(material)) {
              material.forEach((m) => m.dispose());
            } else if (material) {
              material.dispose();
            }
          });
          renderer.dispose();
          if (renderer.domElement.parentNode === container) {
            container.removeChild(renderer.domElement);
          }
        },
      };
    }

    return () => {
      disposed = true;
      sceneApiRef.current?.dispose();
      sceneApiRef.current = null;
      setTooltip(null);
    };
  }, [projectId, nodeLimit]);

  // 搜索：命中则高亮目标文件及其最相似群组并聚焦，清空则恢复。
  useEffect(() => {
    const api = sceneApiRef.current;
    const q = query.trim();
    if (!q) {
      setHasMatch(true);
      api?.highlight(null);
      return;
    }
    const index = api?.findIndex(q) ?? -1;
    setHasMatch(index >= 0);
    if (index >= 0) {
      api?.highlight(index);
      api?.focus(index);
    } else {
      api?.highlight(null);
    }
  }, [query]);

  return (
    <div className="codebase-sphere" ref={containerRef}>
      {state === "loading" && (
        <div className="codebase-panel-state">
          <Loader2 size={18} strokeWidth={1.8} className="spin" />
          <span>{t("codebase.panel.sphereLoading")}</span>
        </div>
      )}
      {state === "error" && (
        <div className="codebase-panel-state codebase-panel-error">
          {t("codebase.panel.sphereError")}
        </div>
      )}
      {state === "empty" && (
        <div className="codebase-panel-state">
          {t("codebase.panel.sphereEmpty")}
        </div>
      )}
      {state === "ready" && (
        <div className="codebase-sphere-hint">
          <span className="codebase-sphere-hint-info">
            {totalFiles > shownCount
              ? t("codebase.panel.sphereNodesLimited", {
                  values: { count: shownCount, total: totalFiles },
                })
              : t("codebase.panel.sphereNodes", {
                  values: { count: shownCount },
                })}
            <span className="codebase-sphere-hint-dot" />
            {t("codebase.panel.sphereHint")}
          </span>
          <input
            type="search"
            className="codebase-sphere-search-input"
            placeholder={t("codebase.panel.sphereSearchPlaceholder")}
            aria-label={t("codebase.panel.sphereSearchPlaceholder")}
            value={query}
            onChange={(event) => {
              queryRef.current = event.target.value;
              setQuery(event.target.value);
            }}
          />
          {query.trim() !== "" && !hasMatch && (
            <span className="codebase-sphere-search-nomatch">
              {t("codebase.panel.sphereSearchNoMatch")}
            </span>
          )}
          <select
            className="codebase-sphere-limit-select"
            value={nodeLimit}
            title={t("codebase.panel.sphereLimitTitle")}
            onChange={(event) =>
              setNodeLimit(event.target.value as NodeLimit)
            }
          >
            <option value="all">{t("codebase.panel.sphereLimitAll")}</option>
            {LIMIT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      )}
      {state === "ready" && tooltip && (
        <div
          className="codebase-sphere-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div
            className="codebase-sphere-tooltip-path"
            title={tooltip.node.path}
          >
            <span className="codebase-sphere-tooltip-file-icon">
              {getFileTypeIcon(getBaseName(tooltip.node.path), false, false, {
                size: 12,
              })}
            </span>
            <span className="codebase-sphere-tooltip-path-name">
              {tooltip.node.path}
            </span>
          </div>
          <div className="codebase-sphere-tooltip-row">
            <span>{t("codebase.panel.colChunks")}</span>
            <span>{tooltip.node.chunkCount}</span>
          </div>
          <div className="codebase-sphere-tooltip-row">
            <span>{t("codebase.panel.colLines")}</span>
            <span>
              {tooltip.node.startLine > 0 && tooltip.node.endLine > 0
                ? `${tooltip.node.startLine} - ${tooltip.node.endLine}`
                : "-"}
            </span>
          </div>
          <div className="codebase-sphere-tooltip-row">
            <span>{t("codebase.panel.colSize")}</span>
            <span>{formatBytes(tooltip.node.sizeBytes)}</span>
          </div>
          {tooltip.neighbors.length > 0 && (
            <div className="codebase-sphere-tooltip-neighbors">
              <div className="codebase-sphere-tooltip-neighbors-title">
                {t("codebase.panel.sphereNeighbors")}
              </div>
              {tooltip.neighbors.map((neighbor) => (
                <div
                  key={neighbor.path}
                  className="codebase-sphere-tooltip-neighbor"
                  title={neighbor.path}
                >
                  <span className="codebase-sphere-tooltip-file-icon">
                    {getFileTypeIcon(getBaseName(neighbor.path), false, false, {
                      size: 12,
                    })}
                  </span>
                  <span className="codebase-sphere-tooltip-neighbor-name">
                    {neighbor.path}
                  </span>
                  <span>{Math.round(neighbor.similarity * 100)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
