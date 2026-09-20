/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

declare namespace JSX {
  interface IntrinsicElements {
    "s-app-nav": {
      children?: React.ReactNode;
    };
    "s-link": {
      href: string;
      rel?: "home";
      children?: string;
    };
  }
}
