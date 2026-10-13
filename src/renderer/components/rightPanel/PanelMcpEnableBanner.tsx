import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { MCP_SERVER_STATE_CHANGED_EVENT } from "../mainContent/chatInput/mcpServerEvents";

export const BROWSER_MCP_SERVER_ID = "builtin:browser";
export const TERMINAL_MCP_SERVER_ID = "builtin:terminal";

type McpServerState = "unknown" | "enabled" | "disabled";

const useProjectMcpServerState = (
  projectId: string | undefined,
  serverId: string,
): McpServerState => {
  const [state, setState] = useState<McpServerState>("unknown");

  useEffect(() => {
    if (!projectId) {
      setState("unknown");
      return;
    }
    let disposed = false;
    const load = async (): Promise<void> => {
      try {
        const servers =
          await window.snow.listMcpProjectServersCached(projectId);
        const server = servers.find((item) => item.id === serverId);
        if (disposed) {
          return;
        }
        setState(
          !server
            ? "unknown"
            : server.globalEnabled && server.enabled
              ? "enabled"
              : "disabled",
        );
      } catch {
        if (!disposed) {
          setState("unknown");
        }
      }
    };
    void load();
    window.addEventListener(MCP_SERVER_STATE_CHANGED_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      disposed = true;
      window.removeEventListener(MCP_SERVER_STATE_CHANGED_EVENT, load);
      window.removeEventListener("focus", load);
    };
  }, [projectId, serverId]);

  return state;
};

export type PanelMcpEnableBannerProps = {
  projectId?: string;
  serverId: string;
  messageKey: string;
  active: boolean;
  onOpenMcpPanel: (serverId: string) => void;
};

export const PanelMcpEnableBanner = ({
  projectId,
  serverId,
  messageKey,
  active,
  onOpenMcpPanel,
}: PanelMcpEnableBannerProps): React.JSX.Element | null => {
  const { t } = useI18n();
  const state = useProjectMcpServerState(projectId, serverId);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (active) {
      setDismissed(false);
    }
  }, [active]);

  if (!projectId || state !== "disabled" || dismissed) {
    return null;
  }

  return (
    <div className="panel-mcp-gate-banner" role="status">
      <AlertTriangle
        aria-hidden="true"
        className="panel-mcp-gate-banner-icon"
        size={14}
        strokeWidth={1.8}
      />
      <span className="panel-mcp-gate-banner-text">{t(messageKey)}</span>
      <button
        className="panel-mcp-gate-banner-action"
        onClick={() => onOpenMcpPanel(serverId)}
        type="button"
      >
        {t("panelMcpGate.enable")}
      </button>
      <button
        aria-label={t("panelMcpGate.dismiss")}
        className="panel-mcp-gate-banner-close"
        onClick={() => setDismissed(true)}
        title={t("panelMcpGate.dismiss")}
        type="button"
      >
        <X aria-hidden="true" size={13} strokeWidth={1.8} />
      </button>
    </div>
  );
};
