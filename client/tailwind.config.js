export default {
  content: ["./index.html","./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter","ui-sans-serif","system-ui","sans-serif"] },
      colors: {
        ink: "#111827",
        muted: "#6b7280",
        border: "#e5e7eb",
        accent: { DEFAULT: "#4f46e5", hover: "#4338ca", soft: "#eef2ff" },
      },
      boxShadow: { card: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)" }
    }
  },
  plugins: []
};
