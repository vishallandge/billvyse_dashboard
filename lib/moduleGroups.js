import { ShieldIcon, ReceiptIcon, TruckIcon, SettingsIcon, TrendUpIcon } from '../app/components/Icons';

// One icon per module group (backend/config/modules.js MODULE_GROUPS) — shared between
// /admin/modules and the per-shop module list so a group reads the same way in both.
export const GROUP_ICONS = {
  core: ShieldIcon,
  sales: ReceiptIcon,
  supply: TruckIcon,
  ops: SettingsIcon,
  growth: TrendUpIcon,
};

export function groupIcon(key) {
  return GROUP_ICONS[key] || SettingsIcon;
}
