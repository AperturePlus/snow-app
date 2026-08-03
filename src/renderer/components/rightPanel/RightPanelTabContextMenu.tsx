import { Globe, Terminal, X } from "lucide-react";
import { useI18n } from "../../i18n";
import {
  ContextMenu,
  type ContextMenuItem,
} from "../common/ContextMenu";

type RightPanelTabContextMenuProps = {
  /** 右键时的鼠标坐标（viewport 坐标）。 */
  x: number;
  y: number;
  /** 该 tab 是否允许关闭（Git 固定 tab 不可关闭）。 */
  isClosable: boolean;
  onNewTerminal: () => void;
  onNewBrowser: () => void;
  onCloseTab: () => void;
  onClose: () => void;
};

/**
 * 右侧面板 tab 的右键菜单：新建终端 / 新建浏览器 / 关闭标签页。
 * 定位在鼠标点击处，越界时自动收进视口；点击外部或按 Esc 关闭。
 */
export function RightPanelTabContextMenu({
  x,
  y,
  isClosable,
  onNewTerminal,
  onNewBrowser,
  onCloseTab,
  onClose,
}: RightPanelTabContextMenuProps): React.JSX.Element {
  const { t } = useI18n();

  const items: ContextMenuItem[] = [
    {
      id: "new-terminal",
      label: t("rightPanel.tabContextNewTerminal", {
        defaultValue: "New Terminal",
      }),
      icon: <Terminal size={13} strokeWidth={1.8} />,
      onClick: onNewTerminal,
    },
    {
      id: "new-browser",
      label: t("rightPanel.tabContextNewBrowser", {
        defaultValue: "New Browser",
      }),
      icon: <Globe size={13} strokeWidth={1.8} />,
      onClick: onNewBrowser,
    },
  ];

  const footerItems: ContextMenuItem[] | undefined = isClosable
    ? [
        {
          id: "close-tab",
          label: t("rightPanel.closeTab", { defaultValue: "Close tab" }),
          icon: <X size={13} strokeWidth={1.8} />,
          onClick: onCloseTab,
        },
      ]
    : undefined;

  return (
    <ContextMenu
      x={x}
      y={y}
      items={items}
      footerItems={footerItems}
      onClose={onClose}
    />
  );
}
