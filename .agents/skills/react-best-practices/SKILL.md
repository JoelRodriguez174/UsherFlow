---
name: react-best-practices
description: "Comprehensive performance optimization guide for React and Next.js applications, maintained by Vercel. Use when writing new React components or Next.js pages, implementing data fetching (client or server-side), or reviewing code for performance issues."
risk: safe
source: community
date_added: "2026-02-27"
---

# Vercel React Best Practices

Comprehensive performance optimization guide for React and Next.js applications, maintained by Vercel. Contains 45 rules across 8 categories, prioritized by impact to guide automated refactoring and code generation.

## Rule Categories by Priority
1. Eliminating Waterfalls (CRITICAL): `Promise.all()`, defer await, Suspense boundaries.
2. Bundle Size Optimization (CRITICAL): direct imports, dynamic imports for modals.
3. Server-Side Performance (HIGH): `React.cache()` deduplication.
4. Client-Side Data Fetching (MEDIUM-HIGH): SWR / Realtime deduplication, local optimistic state.
5. Re-render Optimization (MEDIUM): `React.memo()`, `useCallback`, `useMemo`, fine-grained state updates.
6. Rendering Performance (MEDIUM): Virtualization or pagination for long lists, DOM element count.
7. JavaScript Performance (LOW-MEDIUM): Fast loop iterations, Map/Set for lookup.
8. Advanced Patterns (LOW): Functional setState, stable handlers.
