import { AlertTriangle, BellOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { ContextMenu, type ContextMenuItem } from "../common/ContextMenu";
import { MCP_SERVER_STATE_CHANGED_EVENT } from "../mainContent/chatInput/mcpServerEvents";
import {
  isPanelMcpHintSuppressed,
  subscribePanelMcpHintSuppression,
  suppressPanelMcpHint,
} from "./panelMcpHintSuppression";

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
  const [suppressed, setSuppressed] = useState(() =>
    isPanelMcpHintSuppressed(serverId),
  );
  const [menuPosition, setMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // 关闭只对本次打开生效：面板再次激活（下次打开 / 切回该 tab）时重新提示。
  useEffect(() => {
    if (active) {
      setDismissed(false);
    }
  }, [active]);

  useEffect(() => {
    setSuppressed(isPanelMcpHintSuppressed(serverId));
    return subscribePanelMcpHintSuppression(() => {
      setSuppressed(isPanelMcpHintSuppressed(serverId));
    });
  }, [serverId]);

  if (!projectId || state !== "disabled" || dismissed || suppressed) {
    return null;
  }

  const menuItems: ContextMenuItem[] = [
    {
      id: "dismiss",
      label: t("panelMcpGate.dismissOnce"),
      icon: <X aria-hidden="true" size={13} strokeWidth={1.8} />,
      onClick: () => {
        setMenuPosition(null);
        setDismissed(true);
      },
    },
    {
      id: "suppress",
      label: t("panelMcpGate.dismissAlways"),
      icon: <BellOff aria-hidden="true" size={13} strokeWidth={1.8} />,
      onClick: () => {
        setMenuPosition(null);
        suppressPanelMcpHint(serverId);
      },
    },
  ];

  const handleOpenDismissMenu = (): void => {
    const rect = closeButtonRef.current?.getBoundingClientRect();
    setMenuPosition(
      rect ? { x: rect.left, y: rect.bottom + 4 } : { x: 0, y: 0 },
    );
  };

  return (
    <>
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
          onClick={handleOpenDismissMenu}
          ref={closeButtonRef}
          title={t("panelMcpGate.dismiss")}
          type="button"
        >
          <X aria-hidden="true" size={13} strokeWidth={1.8} />
        </button>
      </div>
      {menuPosition ? (
        <ContextMenu
          ariaLabel={t("panelMcpGate.dismiss")}
          items={menuItems}
          keyboardNavigation
          onClose={() => setMenuPosition(null)}
          returnFocusTo={closeButtonRef.current}
          x={menuPosition.x}
          y={menuPosition.y}
        />
      ) : null}
    </>
  );
};
