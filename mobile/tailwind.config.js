const { hairlineWidth } = require('nativewind/theme');

const color = (name) => `var(--${name})`;

const semanticColors = [
  'background',
  'foreground',
  'border',
  'input',
  'ring',
  'destructive',
  'sidebar',
];

const withForeground = [
  'card',
  'popover',
  'primary',
  'secondary',
  'muted',
  'accent',
];

const sidebarColors = ['primary', 'accent'];

const colors = Object.fromEntries(
  semanticColors.map((name) => [name, color(name)]),
);

for (const name of withForeground) {
  colors[name] = {
    DEFAULT: color(name),
    foreground: color(`${name}-foreground`),
  };
}

for (const name of sidebarColors) {
  colors.sidebar = {
    ...(typeof colors.sidebar === 'object' ? colors.sidebar : {}),
    DEFAULT: color('sidebar'),
    foreground: color('sidebar-foreground'),
    [name]: color(`sidebar-${name}`),
  };
}

colors.sidebar = {
  ...colors.sidebar,
  border: color('sidebar-border'),
  ring: color('sidebar-ring'),
};

colors.chart = Object.fromEntries(
  [1, 2, 3, 4, 5].map((number) => [number, color(`chart-${number}`)]),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors,
      borderRadius: {
        lg: 7.2,
        md: 5.2,
        sm: 3.2,
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
