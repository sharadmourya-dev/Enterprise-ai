# UI/UX Design Specification & Frontend Architectural Standards

> **Status**: Approved & Binding for Frontend Phase (Phase 7)
> **Target Framework**: Next.js 14+ (App Router), React 18, TypeScript, Tailwind CSS

---

## 1. Visual Identity & Design Direction

The Enterprise AI Knowledge & Support Copilot interface must feel like a polished, high-performance production SaaS platform (comparable to Linear, Stripe, or Datadog) rather than an experimental AI demo or generic dashboard.

### 1.1 Aesthetic Principles
- **Clarity & Purpose**: Every element serves an informational or workflow purpose.
- **Restraint Over Flash**: Avoid excessive gradients, glowing neon borders, glassmorphism blur effects, or bouncing decorative animations.
- **Structured Hierarchy**: Distinct background layers, card surfaces, and elevated dialogs. Avoid wrapping every single section into a disjointed card container.
- **Iconography**: Strictly use professional vector iconography (Lucide React). **Never use emojis as interface icons or status indicators.**
- **Micro-Interactions**: Subtle 150ms–200ms ease-out transitions for hovers, button depressions, focus rings, and dropdown expansions.

### 1.2 Color Palette & Semantic Tokens
A tailored, cohesive corporate palette designed for WCAG AA compliance across both light and dark modes:

```css
/* Light Theme */
--bg-canvas: #f8fafc;        /* Slate 50 */
--bg-surface: #ffffff;       /* Pure White */
--bg-surface-elevated: #f1f5f9; /* Slate 100 */
--border-subtle: #e2e8f0;    /* Slate 200 */
--border-strong: #cbd5e1;    /* Slate 300 */
--text-primary: #0f172a;     /* Slate 900 */
--text-secondary: #475569;   /* Slate 600 */
--text-muted: #94a3b8;       /* Slate 400 */

/* Dark Theme */
--bg-canvas: #090d16;        /* Deep Obsidian */
--bg-surface: #111827;       /* Gray 900 */
--bg-surface-elevated: #1e293b; /* Slate 800 */
--border-subtle: #1e293b;    /* Slate 800 */
--border-strong: #334155;    /* Slate 700 */
--text-primary: #f8fafc;     /* Slate 50 */
--text-secondary: #94a3b8;   /* Slate 400 */
--text-muted: #64748b;       /* Slate 500 */

/* Semantic Brand & Status Accents */
--brand-primary: #2563eb;    /* Royal Blue 600 */
--brand-hover: #1d4ed8;      /* Royal Blue 700 */
--status-success: #059669;   /* Emerald 600 */
--status-warning: #d97706;   /* Amber 600 */
--status-error: #dc2626;     /* Rose 600 */
--status-info: #0284c7;      /* Sky 600 */
```

### 1.3 Typography
- **Primary Body Font**: Inter or Geist Sans — clean, neutral grotesque sans-serif with high legibility at small sizes (13px–15px).
- **Display / Heading Font**: Inter / Geist Display (SemiBold / Medium) with tight letter spacing (`tracking-tight`).
- **Monospace Code Font**: JetBrains Mono or Fira Code for code blocks, citations, and JSON telemetry.

---

## 2. Complete Light & Dark Theme Support

1. **Theme Switcher**: An accessible toggle in the header/sidebar supporting `System`, `Light`, and `Dark`.
2. **Persistence**: Preference persisted to `localStorage` and synced via a `theme` cookie to prevent Flash of Unstyled Theme (FOUC).
3. **Consistency**: Applied universally across navigation, chat bubbles, markdown code blocks, modal backdrops, dropdown popovers, tables, and Recharts SVG elements.
4. **Token Usage**: Components must strictly use semantic Tailwind classes (`bg-canvas`, `bg-surface`, `text-primary`, `border-subtle`) rather than hardcoded Hex or arbitrary color values.

---

## 3. Responsive Layout & Mobile-First Architecture

The application must render fluidly across six viewport tiers:
- **Small Mobile**: 320px – 480px
- **Large Mobile**: 481px – 767px
- **Tablet**: 768px – 1023px
- **Laptop**: 1024px – 1439px
- **Desktop**: 1440px – 1919px
- **Ultra-Wide**: 1920px+

### 3.1 Mobile UX Requirements
- **Sidebar Navigation**: Collapses on `<1024px` into an accessible drawer with backdrop overlay.
- **Touch Targets**: Minimum touch target size of 44px × 44px for buttons, menu items, and message action triggers.
- **Zero Horizontal Scroll**: Tables on small viewports transform into responsive card rows or offer styled horizontal swipe wrappers with scroll-shadow indicators.
- **Citation Drawer**: On desktop, slides in as a split right panel (380px); on mobile, renders as a bottom sheet (`max-h-[85vh]`).

---

## 4. Product Workflow Experiences

### 4.1 Enterprise Copilot Chat Interface
- **Prompt Input**: Expanding auto-resize textarea with keyboard shortcuts (`Enter` to send, `Shift+Enter` for newline).
- **Streaming Output**: Real-time token append using custom SSE reader with smooth scroll lock.
- **Citations Ribbon**: Compact, interactive citation tags below assistant messages: `[Doc #1: Page 4 (92% match)]`. Clicking opens the document citation drawer with highlighted snippet.
- **Response Actions**: Copy markdown button, thumbs up/down feedback triggers, and latency/model telemetry tags.

### 4.2 Document Repository & Ingestion Status
- **Upload Zone**: Accessible drag-and-drop zone with instant file validation (PDF, DOCX, TXT; max 50MB).
- **Access Control Configurator**: Clearance level picker (`public`, `internal`, `confidential`, `restricted`) and department tag multiselect.
- **Live Status Tracker**: Progress indicator reflecting ingestion steps: Uploaded $\to$ Parsing $\to$ Chunking $\to$ Embedding $\to$ Qdrant Indexed.

### 4.3 Realistic UI States
- **Loading**: Skeleton shimmer blocks matching target dimensions (no spinning full-page overlays).
- **Empty States**: Helpful illustrations, explanatory copy, and clear primary CTA (e.g. "No documents uploaded yet. Upload corporate policies to start searching.").
- **Error States**: Clear error description, error code, and actionable "Retry" button.
- **Success States**: Toast notifications (dismissible, auto-hide in 4000ms).
