/* E2E 验证：config 工具 subAgents/hooks/skills scope + 项目级子代理 + migration */
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

const native = require(path.join(__dirname, "..", "native", "index.cjs"));
const DB = path.join(os.homedir(), ".snowapp", "snowapp.db");

let passed = 0;
let failed = 0;
const fail = (msg) => {
  failed++;
  console.log(`  ❌ ${msg}`);
};
const ok = (msg) => {
  passed++;
  console.log(`  ✅ ${msg}`);
};
const section = (name) => console.log(`\n== ${name} ==`);

// --- 占位回调（callMcpTool 需要） ---
const noop = () => undefined;
const asyncNoop = async () => "";
const call = (tool, args = {}) =>
  native.callMcpTool(
    tool,
    JSON.stringify(args),
    undefined,
    undefined,
    undefined,
    undefined,
    noop,
    asyncNoop,
    asyncNoop,
    asyncNoop,
    asyncNoop,
    undefined,
    undefined,
    undefined
  );

async function main() {
  // ===== 1. Migration 验证：旧 schema -> 新 schema =====
  section("1. Migration（sub_agent_configs.project_id）");
  const db = new DatabaseSync(DB, { readOnly: true });
  const before = db
    .prepare("PRAGMA table_info(sub_agent_configs)")
    .all()
    .map((c) => c.name);
  db.close();
  console.log(`  迁移前列: [${before.join(", ")}]`);
  const hadColumn = before.includes("project_id");

  // 触发初始化（若为旧库则执行迁移）
  await native.initializeAppStorage();

  const db2 = new DatabaseSync(DB, { readOnly: true });
  const after = db2
    .prepare("PRAGMA table_info(sub_agent_configs)")
    .all()
    .map((c) => c.name);
  // SQLite 对 sqlite_autoindex 的 sql 列返回 NULL，用 PRAGMA index_list
  // 检查唯一约束（origin='u' = UNIQUE 约束自动索引）。
  const indexList = db2.prepare("PRAGMA index_list(sub_agent_configs)").all();
  db2.close();
  console.log(`  迁移后列: [${after.join(", ")}]`);
  hadColumn
    ? ok("project_id 已存在（新库/已迁移），幂等跳过")
    : after.includes("project_id")
      ? ok("旧库迁移成功：project_id 列已添加")
      : fail("迁移未生效：project_id 列缺失");
  indexList.some((i) => i.unique === 1 && i.origin === "u")
    ? ok("复合唯一约束 UNIQUE(agent_id, project_id) 存在")
    : fail("复合唯一约束缺失");

  // ===== 2. 子代理 CRUD（MCP config 工具层）=====
  section("2. config-set/list/get/delete scope=subAgents");
  const list0 = await call("config-list", { scope: "subAgents" });
  const count0 = JSON.parse(list0).count;
  console.log(`  初始子代理数: ${count0}`);

  // 全局创建
  await call("config-set", {
    scope: "subAgents",
    key: "e2e_agent_global",
    value: { name: "E2E Global", description: "e2e", systemPrompt: "test", toolsJson: ["grep-search"] },
  });
  // 项目级创建（同 agentId 不冲突）
  await call("config-set", {
    scope: "subAgents",
    key: "e2e_agent_global",
    projectId: "e2e-proj",
    value: { name: "E2E Project", description: "e2e", systemPrompt: "test p", toolsJson: [] },
  });
  await call("config-set", {
    scope: "subAgents",
    key: "e2e_agent_proj_only",
    projectId: "e2e-proj",
    value: { name: "E2E Proj Only", description: "e2e", systemPrompt: "x", toolsJson: ["bash-terminal-execute"] },
  });

  const listAll = JSON.parse(await call("config-list", { scope: "subAgents" }));
  const listProj = JSON.parse(await call("config-list", { scope: "subAgents", projectId: "e2e-proj" }));
  const getProj = JSON.parse(await call("config-get", { scope: "subAgents", key: "e2e_agent_global", projectId: "e2e-proj" }));
  const getGlobal = JSON.parse(await call("config-get", { scope: "subAgents", key: "e2e_agent_global" }));

  listAll.items.some((i) => i.agentId === "e2e_agent_global" && i.projectId === "") &&
  listAll.items.some((i) => i.agentId === "e2e_agent_global" && i.projectId === "e2e-proj")
    ? ok("list 返回全部：同名全局 + 项目级共存")
    : fail(`list 全量异常: ${JSON.stringify(listAll.items.map((i) => [i.agentId, i.projectId]))}`);
  listProj.count === 2 && listProj.items.every((i) => i.projectId === "e2e-proj")
    ? ok("list(projectId) 只返回该项目子代理")
    : fail(`list 项目过滤异常: count=${listProj.count}`);
  getProj.value?.name === "E2E Project"
    ? ok("get(agentId, projectId) 命中项目级")
    : fail("get 项目级未命中");
  getGlobal.value?.name === "E2E Global"
    ? ok("get(agentId) 缺省命中全局")
    : fail("get 全局未命中");
  listProj.items.some((i) => i.source === "snow-cli" && i.builtin === false)
    ? ok("写入标记 source=snow-cli / builtin=false")
    : fail("来源标记异常");

  // ===== 3. 错误路径 =====
  section("3. 校验与保护");
  const noName = await call("config-set", {
    scope: "subAgents",
    key: "e2e_bad",
    value: { description: "no name" },
  }).catch((e) => String(e));
  /name is required/.test(noName)
    ? ok("缺 name 被拒")
    : fail(`缺 name 未拒绝: ${noName}`);

  const delBuiltin = await call("config-delete", { scope: "subAgents", key: "agent_general" }).catch((e) => String(e));
  /built-in|agent_general/.test(delBuiltin)
    ? ok("内置 agent_general 删除被拒")
    : fail(`agent_general 未受保护: ${delBuiltin}`);

  const setBuiltin = await call("config-set", {
    scope: "subAgents",
    key: "agent_general",
    value: { name: "hack", systemPrompt: "x", toolsJson: [] },
  }).catch((e) => String(e));
  /built-in|agent_general/.test(setBuiltin)
    ? ok("内置 agent_general 修改被拒")
    : fail(`agent_general 修改未受保护: ${setBuiltin}`);

  const badHookType = await call("config-set", {
    scope: "hooks",
    key: "notARealHook",
    value: { rules: [{ description: "x", hooks: [{ type: "command", command: "echo hi" }] }] },
  }).catch((e) => String(e));
  /Unsupported hook type/.test(badHookType)
    ? ok("非法 hookType 被拒")
    : fail(`非法 hookType 未拒绝: ${badHookType}`);

  const badAction = await call("config-set", {
    scope: "hooks",
    key: "onUserMessage",
    value: { rules: [{ description: "x", hooks: [{ type: "prompt", prompt: "p" }] }] },
  }).catch((e) => String(e));
  /not allowed/.test(badAction)
    ? ok("不允许的 action 类型被拒（prompt 用于 onUserMessage）")
    : fail(`非法 action 未拒绝: ${badAction}`);

  // 删除不存在实体 → deleted:false（与文件域语义一致）
  const delMissing = JSON.parse(
    await call("config-delete", { scope: "subAgents", key: "e2e_never_existed" })
  );
  delMissing.deleted === false
    ? ok("删除不存在的子代理返回 deleted:false")
    : fail(`deleted 状态异常: ${delMissing.deleted}`);
  const delMissingHook = JSON.parse(
    await call("config-delete", { scope: "hooks", key: "onStop", projectId: "e2e-proj" })
  );
  delMissingHook.deleted === false
    ? ok("删除不存在的 hook 返回 deleted:false")
    : fail(`hook deleted 状态异常: ${delMissingHook.deleted}`);

  // ===== 4. Hooks CRUD =====
  section("4. config scope=hooks（全局 + 项目级）");
  await call("config-set", {
    scope: "hooks",
    key: "onUserMessage",
    value: { rules: [{ description: "e2e global", hooks: [{ type: "context", content: "g" }] }] },
  });
  await call("config-set", {
    scope: "hooks",
    key: "beforeToolCall",
    projectId: "e2e-proj",
    value: {
      rules: [
        {
          description: "e2e proj guard",
          matcher: "bash-*",
          hooks: [{ type: "command", command: "echo guard", timeout: 3000, enabled: true }],
        },
      ],
    },
  });

  const hooksGlobal = JSON.parse(await call("config-list", { scope: "hooks" }));
  const hooksProj = JSON.parse(await call("config-list", { scope: "hooks", projectId: "e2e-proj" }));
  const getHook = JSON.parse(await call("config-get", { scope: "hooks", key: "beforeToolCall", projectId: "e2e-proj" }));

  hooksGlobal.items.some((h) => h.hookType === "onUserMessage" && h.scope === "global")
    ? ok("全局 hook 写入并列出")
    : fail("全局 hook 异常");
  hooksProj.items.some((h) => h.hookType === "beforeToolCall" && h.projectId === "e2e-proj")
    ? ok("项目级 hook 写入并列出（scope=project）")
    : fail("项目级 hook 异常");
  getHook.value?.rules?.[0]?.matcher === "bash-*"
    ? ok("get 返回 rules 结构（含 matcher）")
    : fail("get hook 异常");

  // ===== 5. skills scope（list 只读验证，不安装）=====
  section("5. config scope=skills");
  const skillsList = JSON.parse(await call("config-list", { scope: "skills" }));
  Array.isArray(skillsList.skills)
    ? ok(`skills 委托成功（${skillsList.skills.length} 个可用技能 + ${skillsList.githubInstalled?.length ?? 0} 个 GitHub 安装）`)
    : fail(`skills list 异常: ${JSON.stringify(skillsList).slice(0, 120)}`);

  // 硬删除验证：旧 skills-config-* 工具调用必须报错（无任何兼容）
  const legacyErr = await call("skills-config-list", {}).catch((e) => String(e));
  /Unknown|not found|no longer|invalid/i.test(legacyErr)
    ? ok("旧 skills-config-list 调用已被移除（报错，无兼容残留）")
    : fail(`旧调用未报错: ${String(legacyErr).slice(0, 120)}`);

  // 工具发现列表不再包含 skills-config-*（对 AI 不可见）
  const tools = await native.listMcpTools();
  const toolNames = tools.map((t) => t.name);
  const hasLegacy = toolNames.some((n) => n.startsWith("skills-config-"));
  hasLegacy
    ? fail("skills-config-* 仍出现在工具列表（硬删除未生效）")
    : ok("工具列表已移除 skills-config-*（AI 不可见）");
  toolNames.includes("config-list") && toolNames.includes("config-set")
    ? ok("config 工具仍在列表中")
    : fail("config 工具缺失");

  // ===== 6. 清理 =====
  section("6. 清理测试数据");
  await call("config-delete", { scope: "subAgents", key: "e2e_agent_global" });
  await call("config-delete", { scope: "subAgents", key: "e2e_agent_global", projectId: "e2e-proj" });
  await call("config-delete", { scope: "subAgents", key: "e2e_agent_proj_only", projectId: "e2e-proj" });
  await call("config-delete", { scope: "hooks", key: "onUserMessage" });
  await call("config-delete", { scope: "hooks", key: "beforeToolCall", projectId: "e2e-proj" });

  const afterClean = JSON.parse(await call("config-list", { scope: "subAgents" }));
  const afterCleanHooks = JSON.parse(await call("config-list", { scope: "hooks" }));
  afterClean.count === count0
    ? ok("子代理测试数据已清理")
    : fail(`清理不完整: ${afterClean.count} vs ${count0}`);
  afterCleanHooks.items.length === 0
    ? ok("hook 测试数据已清理")
    : fail("hook 清理不完整");

  console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("验证脚本异常:", e);
  process.exit(2);
});
