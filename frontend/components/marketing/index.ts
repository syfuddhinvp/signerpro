/** The marketing component kit. Pages import from here, not from the files. */
export { Section, Container, Eyebrow, Display, Lead, SectionHeader, Chip, Grid, Card, cx } from './primitives';
export { Cta, CtaRow } from './Cta';
export { default as Nav } from './Nav';
export { default as Footer } from './Footer';
export { default as Hero } from './Hero';
export { default as FeatureBlock } from './FeatureBlock';
export { default as ProofStrip } from './ProofStrip';
export { default as Faq } from './Faq';
export { default as CtaBand } from './CtaBand';
export { default as StepList } from './StepList';
export { default as PricingCards } from './PricingCards';
export { default as PlanMatrix } from './PlanMatrix';
export { default as CompareTable } from './CompareTable';
export { default as CodeTabs } from './CodeTabs';
export { BrowserFrame, PhoneFrame } from './frames';
export {
  PaymentsMock, RoutingMock, AuditMock, TemplatesMock,
  BrandingMock, ApiMock, PrepareMock, SigningMock,
} from './mocks';
export type { ProofMetric } from './ProofStrip';
export type { FaqItem } from './Faq';
export type { Step } from './StepList';
export type { CompareRow } from './CompareTable';
export type { MatrixRow, MatrixCategory, MatrixCell } from './PlanMatrix';
export type { CodeSample } from './CodeTabs';
