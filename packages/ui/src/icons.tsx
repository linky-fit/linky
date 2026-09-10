import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronDown,
  CircleAlert,
  Clock,
  Copy,
  Download,
  FileText,
  Heart,
  Info,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Plus,
  QrCode,
  Reply,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sun,
  Moon,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  Wallet,
  WifiOff,
  X,
} from "lucide-react-native";
import { getVariableValue, useTheme } from "tamagui";
import type { ColorTokens } from "tamagui";
export const icons = {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronDown,
  CircleAlert,
  Clock,
  Copy,
  Download,
  FileText,
  Heart,
  Info,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Plus,
  QrCode,
  Reply,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sun,
  Moon,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  Wallet,
  WifiOff,
  X,
};
export type IconName = keyof typeof icons;
export interface IconProps {
  name: IconName;
  size?: number;
  color?: ColorTokens;
}
export function Icon({ name, size = 20, color = "$color" }: IconProps) {
  const theme = useTheme();
  const Component = icons[name];
  return (
    <Component
      size={size}
      color={
        color.startsWith("$") ? getVariableValue(theme[color.slice(1)]) : color
      }
      strokeWidth={2}
      aria-hidden
    />
  );
}
