// Hệ thống màu sắc và phong cách giao diện hiện đại cho Cứu trợ Thiên tai C48

export const THEME = {
  colors: {
    // Màu khẩn cấp & SOS (Báo động, nguy cơ tính mạng)
    emergency: {
      main: '#DC2626', // Red 600
      dark: '#991B1B', // Red 800
      light: '#F87171', // Red 400
      bg: '#FEF2F2', // Red 50
      border: '#FECACA', // Red 200
    },
    // Màu cảnh báo & trung bình (Đang xác minh, P2)
    warning: {
      main: '#F59E0B', // Amber 500
      dark: '#B45309', // Amber 700
      light: '#FBBF24', // Amber 400
      bg: '#FFFBEB', // Amber 50
      border: '#FDE68A', // Amber 200
    },
    // Màu thành công & an toàn (Đã tiếp cận, cứu trợ hoàn tất)
    success: {
      main: '#10B981', // Emerald 500
      dark: '#047857', // Emerald 700
      light: '#34D399', // Emerald 400
      bg: '#ECFDF5', // Emerald 50
      border: '#A7F3D0', // Emerald 200
    },
    // Màu thương hiệu điều phối & nhiệm vụ (Đội cứu hộ, thông tin chính thống)
    primary: {
      main: '#2563EB', // Blue 600
      dark: '#1D4ED8', // Blue 700
      light: '#60A5FA', // Blue 400
      bg: '#EFF6FF', // Blue 50
      border: '#BFDBFE', // Blue 200
    },
    // Gam màu trung tính & bề mặt (Neutral / Slate)
    surface: {
      background: '#F8FAFC', // Slate 50
      card: '#FFFFFF',
      border: '#E2E8F0', // Slate 200
      divider: '#CBD5E1', // Slate 300
    },
    text: {
      primary: '#0F172A', // Slate 900 - Độ tương phản cao
      secondary: '#475569', // Slate 600
      muted: '#94A3B8', // Slate 400
      inverse: '#FFFFFF',
    },
  },
  typography: {
    fontSizes: {
      xs: 12,
      sm: 14,
      base: 16,
      lg: 18,
      xl: 20,
      '2xl': 24,
      '3xl': 30,
      '4xl': 36,
    },
  },
  shadows: {
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 2,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 4,
    },
    emergency: {
      shadowColor: '#DC2626',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35,
      shadowRadius: 10,
      elevation: 8,
    },
  },
};
