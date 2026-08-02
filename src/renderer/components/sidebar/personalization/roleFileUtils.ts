import type { SshConnectParams } from "../../../../preload";

export type ProjectDirectoryInfo = {
  path: string;
  isSsh: boolean;
};

const ROLE_FILE_NAME = "ROLE.md";

/** 根据项目 ID 解析工作区目录（本地或 SSH）。 */
export const resolveProjectDirectory = async (
  projectId: string
): Promise<ProjectDirectoryInfo | null> => {
  const directories = await window.snow.listWorkspaceDirectories();
  const matched = directories.find(
    (directory) => directory.directoryId === projectId
  );
  if (!matched) {
    return null;
  }
  return {
    path: matched.path,
    isSsh: matched.path.startsWith("ssh://"),
  };
};

/** 构建 SSH 连接参数（复用 RoleEditorPanel 的凭证解析链路）。 */
export const buildSshConnectParams = async (
  sshUrl: string
): Promise<SshConnectParams | null> => {
  const parsed = await window.snow.sshParseUrl(sshUrl);
  const credential = await window.snow.sshGetCredential(
    parsed.host,
    parsed.port,
    parsed.username
  );

  const connectParams: SshConnectParams = {
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    authMethod: credential?.authMethod ?? "password",
  };

  if (credential?.privateKeyPath) {
    connectParams.privateKeyPath = credential.privateKeyPath;
  }

  const secret = credential?.encryptedSecret
    ? await window.snow.sshGetDecryptedSecret(
        parsed.host,
        parsed.port,
        parsed.username
      )
    : null;

  if (secret) {
    if (connectParams.authMethod === "password") {
      connectParams.password = secret;
    } else {
      connectParams.passphrase = secret;
    }
  }

  return connectParams;
};

/** 构建项目 ROLE.md 的完整路径（SSH 工作区为远程路径）。 */
export const buildRoleFilePath = (info: ProjectDirectoryInfo): string => {
  if (info.isSsh) {
    return `${info.path.replace(/^ssh:\/\/[^/]+/, "")}/${ROLE_FILE_NAME}`;
  }
  return `${info.path}/${ROLE_FILE_NAME}`.replace(/\/+/g, "/");
};
