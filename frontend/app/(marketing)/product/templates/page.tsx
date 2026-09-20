/**
 * Templates product page.
 *
 * Every claim maps to FEATURES.md §3 (templates: create, duplicate, archive,
 * usage tracking, "use template") and §2's mention of a shared template
 * catalogue.
 */
import type { Metadata } from 'next';
import {
  Hero,
  FeatureBlock,
  Faq,
  CtaBand,
  Cta,
  CtaRow,
  BrowserFrame,
  ApiMock,
  PrepareMock,
  RoutingMock,
  TemplatesMock,
} from '@/components/marketing';

export const metadata: Metadata = {
  title: 'Stop rebuilding the same document — SignerPro',
  description:
    'Turn any document into a template, reuse it in one click, and start new work from a shared catalogue your whole team can pull from.',
};

const BLOCKS = [
  {
    // FEATURES.md §3 — create a template from any document, promote a document.
    eyebrow: 'Build once',
    title: 'Any document can become a template.',
    body:
      'Prepare a document the way you want it, with fields placed and roles assigned, then save it as a template. The next one starts from there instead of a blank PDF.',
    points: [
      'Create a template from any existing document',
      'Promote a document you already prepared into a reusable one',
      'Fields, roles and routing are saved with the template',
    ],
  },
  {
    // FEATURES.md §3 — use template, duplicate, archive, usage tracking.
    eyebrow: 'Reuse it',
    title: 'One click spawns a ready-to-send document.',
    body:
      '"Use template" creates a new document with fields and roles already placed, so you only fill in what changed. Duplicate a template to branch a variant, and archive the ones you no longer need.',
    points: [
      'Use template pre-places fields and recipient roles on the new document',
      'Duplicate, archive and restore templates like any other document',
      'Usage tracking shows which templates your team actually relies on',
    ],
  },
  {
    // FEATURES.md §2 — shared template catalogue tenants import from; §3.
    eyebrow: 'Start from the catalogue',
    title: 'You do not have to start from nothing either.',
    body:
      'A shared platform catalogue offers common document types your tenant can import as a starting template, so day one does not mean building every form from scratch.',
    points: [
      'A shared catalogue of starting templates available to every tenant',
      'Import a catalogue template, then adjust it to your own fields',
      'Your imported and self-built templates live in the same library',
    ],
    link: { href: '/product/routing', label: 'See how routing works on a template' },
  },
];

const FAQ = [
  {
    q: 'Can I turn a document I already sent into a template?',
    a: 'Yes. Any document can be saved as a template, and its fields, roles and routing come with it.',
  },
  {
    q: 'What happens when I use a template?',
    a: '"Use template" creates a new document with the fields and recipient roles already placed, ready for you to fill in the details that change each time.',
  },
  {
    q: 'Where do the catalogue templates come from?',
    a: 'They come from a shared platform catalogue of common document types, which you can import into your own workspace and adjust as needed.',
  },
  {
    q: 'Can I tell which templates my team actually uses?',
    a: 'Yes, usage tracking on each template shows how often it has been used to start a new document.',
  },
  {
    q: 'What if I need two versions of the same template?',
    a: 'Duplicate it. The copy becomes its own template you can change without touching the original.',
  },
];

/** Product mocks stand in until real captures exist; see
 *  `components/marketing/mocks.tsx` and `scripts/marketing-screenshots.mjs`. */
const BLOCK_ART = [PrepareMock, RoutingMock, ApiMock];

export default function TemplatesPage() {
  return (
    <>
      <Hero
        eyebrow="Templates"
        title="Stop rebuilding the same document."
        lead="Save any document as a template once, then start every future copy from it, with the fields and roles already in place."
        note="Templates are on every plan, including a shared catalogue to start from."
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Start free
            </Cta>
            <Cta href="/product/templates#faq" variant="on-dark" size="lg">
              Read the questions
            </Cta>
          </CtaRow>
        }
        art={
          <BrowserFrame label="app.signerpro.com/templates">
            <TemplatesMock />
          </BrowserFrame>
        }
      />

      {BLOCKS.map((block, index) => {
        const Art = BLOCK_ART[index % BLOCK_ART.length];
        return (
        <FeatureBlock
          key={block.title}
          eyebrow={block.eyebrow}
          title={block.title}
          body={block.body}
          points={block.points}
          link={block.link}
          reverse={index % 2 === 1}
          tone={index % 2 === 1 ? 'alt' : 'canvas'}
          art={
            <BrowserFrame label={`app.signerpro.com/${block.eyebrow.toLowerCase().replace(/\s+/g, '-')}`}>
              <Art />
            </BrowserFrame>
          }
        />
        );
      })}

      <Faq
        items={FAQ}
        title="Questions about templates"
        lead="What happens when you save, reuse or import one."
      />

      <CtaBand
        title="Save your first template today"
        lead="Prepare one document properly, and every future one takes thirty seconds."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
