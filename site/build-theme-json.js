#!/usr/bin/env node

/**
 * build-theme-json.js
 * Generates tgl-theme/theme.json from design-system/tokens.json.
 * Run: node site/build-theme-json.js
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const tokensPath = path.join(rootDir, 'design-system', 'tokens.json');
const outputPath = path.join(rootDir, 'tgl-theme', 'theme.json');

if (!fs.existsSync(tokensPath)) {
  console.error(`Tokens file not found at ${tokensPath}`);
  process.exit(1);
}

const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));

// Build color palette
const palette = [];
const colorCategories = ['bg', 'text', 'accent', 'line'];

for (const cat of colorCategories) {
  if (tokens.color && tokens.color[cat]) {
    for (const [slug, item] of Object.entries(tokens.color[cat])) {
      if (item && item.value) {
        palette.push({
          name: `${cat.toUpperCase()}: ${slug.replace(/-/g, ' ')}`,
          slug: slug === 'hairline' ? 'hairline' : `${slug}`,
          color: item.value
        });
      }
    }
  }
}

// Ensure unique slugs
const uniquePalette = [];
const seenSlugs = new Set();
for (const p of palette) {
  if (!seenSlugs.has(p.slug)) {
    seenSlugs.add(p.slug);
    uniquePalette.push(p);
  }
}

// Build typography with self-hosted fontFace definitions
const fontFamilies = [
  {
    name: 'Display (Fraunces)',
    slug: 'display',
    fontFamily: tokens.font?.display?.family || "'Fraunces', Georgia, serif",
    fontFace: [
      {
        fontFamily: 'Fraunces',
        fontStyle: 'normal',
        fontWeight: '600 800',
        src: ['file:./assets/fonts/fraunces-latin-normal.woff2']
      },
      {
        fontFamily: 'Fraunces',
        fontStyle: 'italic',
        fontWeight: '600 800',
        src: ['file:./assets/fonts/fraunces-latin-italic.woff2']
      }
    ]
  },
  {
    name: 'Body (DM Sans)',
    slug: 'body',
    fontFamily: tokens.font?.body?.family || "'DM Sans', sans-serif",
    fontFace: [
      {
        fontFamily: 'DM Sans',
        fontStyle: 'normal',
        fontWeight: '400 700',
        src: ['file:./assets/fonts/dm-sans-latin.woff2']
      }
    ]
  }
];

const fontSizes = [];
if (tokens['type-scale']) {
  for (const [slug, item] of Object.entries(tokens['type-scale'])) {
    fontSizes.push({
      name: slug.toUpperCase(),
      slug: slug,
      size: item.size
    });
  }
}

const themeJson = {
  $schema: 'https://schemas.wp.org/trunk/theme.json',
  version: 3,
  title: 'TGL Theme',
  settings: {
    appearanceTools: true,
    useRootPaddingAwareAlignments: true,
    layout: {
      contentSize: '800px',
      wideSize: tokens.space?.container?.max || '1200px'
    },
    color: {
      custom: true,
      defaultPalette: false,
      palette: uniquePalette
    },
    typography: {
      fluid: true,
      customFontSize: true,
      fontFamilies: fontFamilies,
      fontSizes: fontSizes
    },
    spacing: {
      units: ['px', 'em', 'rem', 'vh', 'vw', '%']
    }
  },
  styles: {
    color: {
      background: 'var(--wp--preset--color--cream, #F5F0E8)',
      text: 'var(--wp--preset--color--text-primary, #2C2118)'
    },
    typography: {
      fontFamily: 'var(--wp--preset--font-family--body)',
      fontSize: 'clamp(0.95rem, 1.3vw, 1.05rem)',
      lineHeight: '1.7'
    },
    elements: {
      h1: {
        typography: {
          fontFamily: 'var(--wp--preset--font-family--display)',
          fontWeight: '700',
          lineHeight: '1.12'
        },
        color: {
          text: 'var(--wp--preset--color--text-primary, #2C2118)'
        }
      },
      h2: {
        typography: {
          fontFamily: 'var(--wp--preset--font-family--display)',
          fontWeight: '700',
          lineHeight: '1.2'
        },
        color: {
          text: 'var(--wp--preset--color--text-primary, #2C2118)'
        }
      },
      h3: {
        typography: {
          fontFamily: 'var(--wp--preset--font-family--display)',
          fontWeight: '600',
          lineHeight: '1.3'
        },
        color: {
          text: 'var(--wp--preset--color--text-primary, #2C2118)'
        }
      },
      button: {
        color: {
          background: 'var(--wp--preset--color--terracotta, #C75B3B)',
          text: 'var(--wp--preset--color--cream, #F5F0E8)'
        },
        border: {
          radius: '100px'
        },
        typography: {
          fontFamily: 'var(--wp--preset--font-family--body)',
          fontWeight: '600',
          fontSize: '15px'
        },
        spacing: {
          padding: {
            top: '16px',
            bottom: '16px',
            left: '36px',
            right: '36px'
          }
        }
      },
      link: {
        typography: {
          textDecoration: 'none'
        },
        color: {
          text: 'inherit'
        }
      }
    }
  }
};

// Ensure output dir exists
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify(themeJson, null, 2), 'utf8');
console.log(`Successfully generated ${outputPath} from ${tokensPath}`);
