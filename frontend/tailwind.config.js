/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        emerald: {
          500: '#10b981'
        },
        cyan: {
          500: '#06b6d4'
        },
        violet: {
          500: '#8b5cf6'
        },
        rose: {
          500: '#f43f5e'
        },
        gold: {
          500: '#f59e0b'
        },
        orange: {
          500: '#f97316'
        }
      }
    },
  },
  plugins: [],
}

