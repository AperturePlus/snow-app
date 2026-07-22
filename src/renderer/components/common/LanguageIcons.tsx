import type { ComponentType, SVGProps } from "react";

/**
 * 代码语言彩色图标集（LSP 服务用）。
 *
 * 设计规范：24x24 圆角方块徽章 + 品牌色背景 + 居中粗体字形。
 * - 风格一致：所有图标共用同一徽章框架、字号体系与字重。
 * - 彩色：每个图标使用对应语言的品牌色。
 * - 可读性：字形颜色按背景明度在黑/白间选择（无障碍驱动）。
 * - 配色与项目 fileIcons.tsx 中对应扩展名的颜色保持一致。
 */

export type LanguageId =
  | "csharp"
  | "cpp"
  | "c"
  | "typescript"
  | "python"
  | "rust"
  | "go"
  | "javascript"
  | "generic";

type BadgeSpec = {
  /** 徽章背景色（品牌色）。 */
  bg: string;
  /** 字形颜色（黑或白，按对比度选择）。 */
  fg: string;
  /** 徽章内显示的简写。 */
  label: string;
  /** 字号，按字形长度微调以保持视觉平衡。 */
  fontSize: number;
};

const FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const SPECS: Record<LanguageId, BadgeSpec> = {
  csharp: { bg: "#512bd4", fg: "#ffffff", label: "C#", fontSize: 9 },
  cpp: { bg: "#00599c", fg: "#ffffff", label: "C++", fontSize: 8 },
  c: { bg: "#46637d", fg: "#ffffff", label: "C", fontSize: 12 },
  typescript: { bg: "#3178c6", fg: "#ffffff", label: "TS", fontSize: 9.5 },
  python: { bg: "#3776ab", fg: "#ffffff", label: "Py", fontSize: 9.5 },
  rust: { bg: "#b7410e", fg: "#ffffff", label: "Rs", fontSize: 9.5 },
  go: { bg: "#00add8", fg: "#0a1a1f", label: "Go", fontSize: 9.5 },
  javascript: { bg: "#f7df1e", fg: "#1a1a1a", label: "JS", fontSize: 9.5 },
  generic: { bg: "#64748b", fg: "#ffffff", label: "{ }", fontSize: 9 },
};

export type LanguageGlyphProps = SVGProps<SVGSVGElement> & {
  size?: number;
  title?: string;
};

const Badge = ({
  spec,
  size = 16,
  title,
  ...rest
}: LanguageGlyphProps & { spec: BadgeSpec }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    role={title ? "img" : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : true}
    {...rest}
  >
    {title ? <title>{title}</title> : null}
    <rect x={0} y={0} width={24} height={24} rx={5.5} fill={spec.bg} />
    <text
      x={12}
      y={12}
      textAnchor="middle"
      dominantBaseline="central"
      fontFamily={FONT_STACK}
      fontSize={spec.fontSize}
      fontWeight={800}
      fill={spec.fg}
    >
      {spec.label}
    </text>
  </svg>
);

const createIcon = (id: LanguageId): ComponentType<LanguageGlyphProps> => {
  const spec = SPECS[id];
  const Icon = (props: LanguageGlyphProps) => <Badge spec={spec} {...props} />;
  Icon.displayName = `LanguageIcon.${id}`;
  return Icon;
};

export const CSharpIcon = createIcon("csharp");
export const CppIcon = createIcon("cpp");
export const CIcon = createIcon("c");
export const TypeScriptIcon = createIcon("typescript");
export const PythonIcon = createIcon("python");
export const RustIcon = createIcon("rust");
export const GoIcon = createIcon("go");
export const JavaScriptIcon = createIcon("javascript");
export const GenericCodeIcon = createIcon("generic");

const ICON_COMPONENTS: Record<LanguageId, ComponentType<LanguageGlyphProps>> = {
  csharp: CSharpIcon,
  cpp: CppIcon,
  c: CIcon,
  typescript: TypeScriptIcon,
  python: PythonIcon,
  rust: RustIcon,
  go: GoIcon,
  javascript: JavaScriptIcon,
  generic: GenericCodeIcon,
};

const ALIASES: Record<string, LanguageId> = {
  csharp: "csharp",
  "c#": "csharp",
  cs: "csharp",
  cpp: "cpp",
  "c++": "cpp",
  cxx: "cpp",
  cc: "cpp",
  "c-plus-plus": "cpp",
  c: "c",
  "c-lang": "c",
  typescript: "typescript",
  ts: "typescript",
  python: "python",
  py: "python",
  rust: "rust",
  rs: "rust",
  go: "go",
  golang: "go",
  javascript: "javascript",
  js: "javascript",
  ecmascript: "javascript",
  mjs: "javascript",
  cjs: "javascript",
};

/** 受支持的语言规范 ID 列表。 */
export const LANGUAGE_IDS = Object.keys(SPECS) as LanguageId[];

/** 将任意语言字符串归一化为受支持的 LanguageId，未匹配时返回 generic。 */
export const resolveLanguageId = (language: string): LanguageId => {
  const key = language.toLowerCase().trim();
  return ALIASES[key] ?? "generic";
};

/** 根据语言字符串获取对应的图标组件（未匹配时返回通用图标）。 */
export const getLanguageIcon = (
  language: string
): ComponentType<LanguageGlyphProps> =>
  ICON_COMPONENTS[resolveLanguageId(language)];

/** 受支持的语言别名列表（用于下拉/自动补全等场景）。 */
export const SUPPORTED_LANGUAGES = Object.keys(ALIASES);

export type LanguageIconProps = LanguageGlyphProps & {
  language: string;
};

/** 通用语言图标：传入语言字符串即可渲染对应彩色徽章。 */
export const LanguageIcon = ({
  language,
  size = 16,
  title,
  ...rest
}: LanguageIconProps) => {
  const Icon = getLanguageIcon(language);
  return <Icon size={size} title={title ?? language} {...rest} />;
};
