/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dce8ff",
          500: "#4f6cf7",
          600: "#3b55e0",
          700: "#2d41b4",
        },
      },
    },
  },
  plugins: [],
};
