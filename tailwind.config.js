/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./static/**/*.{html,js}", "./static/*.{html,js}"],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                darkbg: '#1a1a1a',
                darkcard: '#2d2d2d',
            }
        },
    },
    plugins: [],
}
