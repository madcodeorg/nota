# Nota website assets

The website keeps the approved October 5 editorial/canvas design and uses three
original, simple paper illustrations made with the built-in Image Gen tool.
Sections share a continuous ivory surface with organic artwork and spacing,
rather than rectangular color bands. Product images are illustrative previews
generated from the selected designs and current Nota UI references; they are not
screenshots that certify release behavior.

- `nota-mark.png`: existing Nota mark from `packages/frontend/core/public/imgs/`.
  `nota-mark-transparent.png` removes its background with Image Gen.
- `fonts/`: existing Inter and Lora font files, plus Google Fonts Tinos
  for the editorial headings. Font license notices are included.
- `icons/`: unmodified [Feather icons](https://github.com/feathericons/feather),
  under the included MIT license.
- `*-workspace.png` and `landscape-paper.png`: generated with the built-in
  Image Gen tool for this website. Product UI, landscape collage, and transparent
  backgrounds follow the approved three-part visual reference.
- `forest-cutout.png` and `.webp`: an Image Gen edit of the landscape with the
  sage paper base removed, used where a transparent forest edge fits the section.
- `paper-current.png` and `.webp`: original blank sheets and a pale sage ribbon
  behind the hero, 1774 × 887. The PNG is 838,065 bytes and WebP is 119,912 bytes.
- `conversation-current.png` and `.webp`: original paper fragments connected by
  an organic graphite thread and faint wash, 1774 × 887. The PNG is 387,792 bytes
  and WebP is 125,924 bytes. The curve continues beneath the meeting preview.
- `paper-idea.png` and `.webp`: original open paper loop for the final action,
  1280 × 1280. It shares the same ivory/sage palette and restrained paper texture.

The three new assets have genuine alpha and were inspected on the actual page.
WebP copies use cwebp `-q 85 -alpha_q 100`. The rejected copied Mad Code clouds
and flowers have been removed. Earlier generated landscape source assets are
retained for reference, but are no longer used as exterior page decoration.

The page uses WebP versions encoded with cwebp, including a smaller responsive
hero image, plus local fonts and the transparent logo. The PNG source assets are
retained for future asset work. Download links lead to the project's GitHub
Releases. At final verification the public Releases page was empty, so the
website says “View releases” and states that public installers are not available
yet. The desktop app is Mac-only for now; no other-platform links are shown.
Replace release labels and installer availability copy when a Mac installer is
published, preserving the current Mac-only scope.

## Exact generation prompts

### Paper current

```text
Use case: illustration-story.
Asset type: original decorative raster for a warm editorial Nota website hero, placed BEHIND a desktop app preview.
Primary request: An airy abstract arrangement of a few blank warm ivory paper sheets and ONE flowing pale sage paper ribbon. Create an expansive continuous sweeping paper shape left to right across a wide landscape composition, approximately 2048 × 1024. The paper ribbon curls gently through the sheets as a single fluid motion. Keep the center very pale and low contrast so it sits quietly behind a dark app window. A few visible blank paper corners and folds at the sides, with pencil-thin soft crease marks. Soft subtle grounded paper shadows within the artwork, never a background shadow rectangle.
Style/medium: minimal watercolor and gouache illustration on dry cotton paper, editorial warmth, soft broken dry-paper pigment texture, restrained shapes, generous airy spacing.
Color palette: warm ivory #f8f6ef, pale sage #e4e9db, tiny understated olive #626f4e accents only along a few creases. White-cream center and very pale sage outer sweep.
Composition and alpha: genuine transparent background. ALL outer contours on top, bottom and sides must be organic, irregular, and feathered with broken dry-brush texture; fully transparent outside. Do not create a rectangular canvas, rectangular paper backdrop, or straight horizontal band edge. There should be several open transparent gaps between the sheets and around the ribbon. Only 3 to 5 broad paper shapes total, one ribbon. No dense details. Wide left-to-right sweep, floating horizontal editorial decoration. Prefer a subtle flattened loop rather than a dense pile, with lots of transparency.
Constraints: original graphic art, restrained and quiet, minimal rather than scenic. No landscape or detailed scenery. No forests, trees, mountains, clouds, flowers, plants, animals, people, notebooks, books, writing instruments, UI, frames, text, handwriting, logos, watermarks, hard outline border, full-bleed color, solid rectangular background, straight section cut, or physical object photography. Transparent alpha is essential.
```

### Conversation current

```text
Use case: stylized-concept. Asset type: minimal transparent editorial decoration for Nota notes-and-meetings website. Generate ONE2048×1024 wide landscape raster with TRUE transparent alpha background. A single thin continuous hand-drawn graphite thread loops gently from far left to far right, connecting TWO airy lightly folded BLANK cream paper fragments at far left and far right. Abstract visual cue for conversations becoming notes. Thread is organic, uneven, delicate, with one or two relaxed overlapping loops. A VERY pale sage watercolor wash loosely follows portions of the thread with soft drybrush edges and irregular alpha contours in EVERY direction. Extremely restrained sparse composition: center mostly fully transparent or barely tinted because website product preview will sit there. Paper fragments small relative to wide canvas, positioned far left/right, irregular slightly torn or folded edges, almost no shading. Warm editorial gouache and pencil, calm simple original design. Palette ONLY warm cream #f8f6ef, pale sage #e4e9db, muted olive graphite #626f4e. No rectangle or solid background, no flat horizontal boundaries, no straight section cuts. No literal speech bubbles, no icon, no UI, no text, no letters, no logo, no arrows, no trees, no mountains, no flowers, no clouds, no people, no dense shading, no frame, no drop-shadow backdrop, no checkerboard. Keep whole center open and airy. Transparent outside thread, paper fragments and faint organic wash.
```

### Paper idea

```text
Use case: stylized-concept. Asset type: original transparent decorative illustration for Nota's final website call to action. Create a very simple airy paper sculpture: one long blank warm ivory paper strip loosely folded into a gentle three-dimensional open loop, its inside pale sage, a few pencil-thin crease marks and natural deckled edges. The loop suggests an idea taking shape, not a recognizable object or icon. Square 1024x1024 composition with substantial transparent negative space around it, subject centered, art occupies about 70% of the square. Matte handmade paper, restrained watercolor/gouache washes, soft daylight, minimal subtle shading, calm editorial art direction. Colors warm ivory #f8f6ef, pale sage #e4e9db, sparse olive #626f4e. True alpha background. No scenery, plants, flowers, clouds, mountains, letters, writing, text, logos, UI, people, hard outline, border, ground plane, gray rectangle, checkerboard baked into image. Keep it simple and distinct from painterly landscape artwork. No extra objects.
```
