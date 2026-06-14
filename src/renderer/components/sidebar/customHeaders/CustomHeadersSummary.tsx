import { FileText } from "lucide-react";
import { useI18n } from "../../../i18n";
import { getHeaderCount } from "./customHeadersUtils";
import type { CustomHeaderScheme } from "./types";

type CustomHeadersSummaryProps = {
  schemes: CustomHeaderScheme[];
};

export function CustomHeadersSummary({
  schemes,
}: CustomHeadersSummaryProps): React.JSX.Element {
  const { t } = useI18n();
  const activeScheme = schemes.find((scheme) => scheme.isActive);
  const activeHeaderCount = activeScheme ? getHeaderCount(activeScheme) : 0;
  const totalHeaderCount = schemes.reduce(
    (count, scheme) => count + getHeaderCount(scheme),
    0
  );

  return (
    <div className="api-settings-summary-grid">
      <div className="api-settings-summary-card">
        <FileText size={15} strokeWidth={1.8} />
        <span>{schemes.length}</span>
        <small>
          {t("settings.customHeadersSchemeCount", {
            defaultValue: "Schemes",
          })}
        </small>
      </div>
      <div className="api-settings-summary-card wide">
        <FileText size={15} strokeWidth={1.8} />
        <span>{activeScheme?.name || "-"}</span>
        <small>
          {t("settings.customHeadersActiveScheme", {
            defaultValue: "Active scheme",
          })}
        </small>
      </div>
      <div className="api-settings-summary-card">
        <FileText size={15} strokeWidth={1.8} />
        <span>{activeHeaderCount || totalHeaderCount}</span>
        <small>
          {t("settings.customHeadersHeaderCount", {
            defaultValue: "Headers",
          })}
        </small>
      </div>
    </div>
  );
}
