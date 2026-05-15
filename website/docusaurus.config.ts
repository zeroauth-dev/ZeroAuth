import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'ZeroAuth',
  tagline:
    'Enterprise authentication powered by zero-knowledge proofs. No biometric data stored. Ever.',
  favicon: 'img/zeroauth-favicon.svg',

  future: {
    v4: true,
  },

  url: 'https://zeroauth.dev',
  baseUrl: '/docs/',
  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          exclude: ['SUMMARY.md'],
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/zeroauth-mark.svg',
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'ZeroAuth',
      logo: {
        alt: 'ZeroAuth',
        src: 'img/zeroauth-favicon.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          to: '/reference/api-reference',
          label: 'API Reference',
          position: 'left',
        },
        {
          to: '/getting-started/quickstart',
          label: 'Quickstart',
          position: 'left',
        },
        {
          href: 'https://zeroauth.dev',
          label: 'Home',
          position: 'right',
        },
        {
          href: 'https://github.com/zeroauth-dev/ZeroAuth',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Getting Started',
          items: [
            {
              label: 'Overview',
              to: '/',
            },
            {
              label: 'Quickstart',
              to: '/getting-started/quickstart',
            },
            {
              label: 'API Keys',
              to: '/getting-started/api-keys',
            },
          ],
        },
        {
          title: 'Integrations',
          items: [
            {
              label: 'ZKP Biometric Auth',
              to: '/integrations/zkp-biometric-auth',
            },
            {
              label: 'SAML SSO',
              to: '/integrations/saml-sso',
            },
            {
              label: 'OIDC / OAuth 2.0',
              to: '/integrations/oidc',
            },
          ],
        },
        {
          title: 'Reference',
          items: [
            {
              label: 'API Reference',
              to: '/reference/api-reference',
            },
            {
              label: 'Contracts & Circuit',
              to: '/reference/contracts-and-circuit',
            },
            {
              label: 'Privacy & Security',
              to: '/concepts/privacy-and-security',
            },
          ],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'Architecture',
              to: '/concepts/architecture',
            },
            {
              label: 'Platform Capabilities',
              to: '/concepts/production-readiness',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/zeroauth-dev/ZeroAuth',
            },
          ],
        },
      ],
      copyright: `Copyright \u00A9 ${new Date().getFullYear()} ZeroAuth. All rights reserved.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
    docs: {
      sidebar: {
        hideable: true,
      },
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
