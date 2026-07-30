# Merged Promotion Card & Category Buttons in Curved Arc Gallery Design Spec

**Date:** 2026-07-30  
**Feature:** Final Promotion & Category Card integrated directly into the Scroll-Linked Curved Arc Gallery

---

## 1. Overview

Integrate the **Merged Promotion Card & 4 Category Buttons** directly into the curved arc motion track (`BestSellersGallery`) as the **final card item**.

As the user scrolls through the sticky-pinned gallery (`h-[400vh]`), best seller drinks sweep sequentially along the parabolic arc trajectory (bottom-right → center apex → top-left). Once the drinks complete their path, the **Merged Promotion Card & Category Buttons** enters as the grand finale card, coming to rest in center viewport focus to clearly mark the end of the gallery experience.

---

## 2. Technical Implementation Details

### A. Sequence & Trajectory Mapping
- Total items `totalCount = bestSellers.length + 1`.
- Items `0` to `N-1`: Rendered as drink cards gliding along the parabolic arc.
- Item `N` (Last item): Renders the **Merged Promotion Card & Category Buttons**.
- Its window `[windowStart, windowMid, windowEnd]` is positioned at the end of `scrollYProgress`. At the end of the scroll track, `windowMid` aligns near `1.0`, locking the final card cleanly in center focus (`x: 0vw`, `y: -12vh`, `scale: 1.25`, `opacity: 1.0`, `rotate: 0deg`).

### B. Visual Design & Neobrutalist Theme Contrast
- Card Background: `bg-card` (warm cream tone) with `nb-border nb-shadow` (solid border & shadow offset).
- Promotion Section: `PROMOTION` tag, title (`New Member`), description, and `20% OFF` badge button (`bg-[#b3341f] text-white`).
- Divider: Subtle inner separator (`border-t border-border/60`).
- Category Buttons: 4 pill buttons (`Coffee →`, `Tea →`, `Pastries →`, `Blended →`) with flex wrapping (`flex-wrap justify-center gap-2.5 sm:gap-3.5`).

### C. Responsiveness
- Card dimensions: `w-[86vw] max-w-[380px] sm:max-w-[480px] md:max-w-[560px] lg:max-w-[620px]`.
- Fully responsive across mobile, tablet, laptop, and 4K desktop screens.

---

## 3. Verification Plan

- `npm run build` production compilation check.
- Smooth scroll scrubbing test ensuring final card rests cleanly at center.
- Responsive layout verification across all viewport sizes.
