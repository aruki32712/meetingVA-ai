import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#17202a",
        mist: "#edf3f7",
        signal: "#2f80ed",
        meadow: "#1f8a70"
      }
    }
  },
  plugins: []
};

export default config;
