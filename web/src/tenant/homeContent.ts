import type { TenantHomeContent, TenantHomeMetric } from '../types/tenant';

const MAX_TEXT = 4000;
const MAX_SHORT = 240;

function clip(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, max);
}

function clipNullable(value: unknown, max: number): string | null {
  const next = clip(value, max, '');
  return next || null;
}

function normalizeMetric(raw: unknown): TenantHomeMetric | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const label = clip(row.label, 80);
  const percent = Number(row.percent);
  if (!label || Number.isNaN(percent)) return null;
  return {
    label,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
  };
}

/** Rich default Home copy inspired by a full retail-bank marketing site. */
export function defaultHomeContent(applicationName = 'Our bank'): TenantHomeContent {
  const name = applicationName.trim() || 'Our bank';
  return {
    topBarHours: 'M–Th 9:00 – 5:30 · Fri 9:00 – 6:00',
    tagline: 'Personal & business banking built for everyday goals',
    heroHeadline: `Banking that grows with you`,
    heroSupport:
      'From helping your community to traveling with perks, discover accounts and cards built for your financial life — with clear balances, secure transfers, and tools that move you forward.',
    navHome: 'Home',
    navAbout: 'About',
    navBanking: 'Banking',
    navLoans: 'Loans',
    navInvesting: 'Investing',
    navCards: 'Credit Cards',
    navContact: 'Contact',
    bankingTitle: 'Credit Cards',
    bankingLead:
      'From helping out your community to traveling with perks, we have the credit card built for your financial life.',
    bankingBody:
      'Discover options that let you earn extra rewards points and cash back — all with a great, low rate. Your credit card can be a great way to set up smart financial habits and build credit toward big financial goals, like buying a home or a new vehicle.',
    bankingSecondary:
      'Opening your credit card is just the beginning. Whatever goal you’re trying to achieve — from building credit to paying for your next trip with great perks — our team will connect you with the tools that work best for your lifestyle, and help you plan what’s next.',
    philosophyTitle: 'We are efficient to make your business rise',
    philosophyLead: 'Productivity yields growth and money.',
    philosophyBody:
      'We ensure nothing but productivity with your money when you bank with us. Our bank has helped a lot of businesses grow. Be the next.',
    philosophyHighlight:
      'Proven results say it all. Strong outcomes on investment and interest plans. Liquidity and capital accumulation through financial investing is a sound fortress.',
    whyTitle: 'Best reason',
    whySubtitle: 'Why choose us',
    visionTitle: 'Our company vision',
    visionBody:
      'Our vision is to be the undisputed leading and dominant financial services institution globally. Policies and procedural guidelines have been set up by the Bank and are regularly reviewed and revised to ensure they remain relevant, current, and in line with evolving regulatory requirements and leading practices.',
    missionTitle: 'Our company mission',
    missionBody:
      'We deliver reliable banking, clear guidance, and practical products so individuals and businesses can build credit, grow capital, and move confidently toward their next milestone.',
    philosophySectionTitle: 'Our philosophy',
    philosophySectionBody:
      'Security, branding excellence, trusted consulting, and business partnership — measured by results, not slogans. We combine disciplined risk practice with a human approach to every account.',
    metrics: [
      { label: 'Security', percent: 100 },
      { label: 'Branding', percent: 75 },
      { label: 'Consulting', percent: 90 },
      { label: 'Business', percent: 75 },
    ],
    aboutTitle: 'About us',
    aboutBody: `${name} serves personal and business customers with accounts, transfers, cards, and investment guidance. We focus on clarity, security, and long-term relationships.`,
    hoursOnline: '24 hours · 7 days',
    hoursSupport: 'Monday–Thursday · 9:00–17:30 · Friday · 9:00–18:00',
    hoursBranch: 'Monday–Friday · 9:00–16:00',
    hoursSaturday: 'Support desk · 9:00–13:00',
    headOfficeTitle: 'Head office',
    headOfficeAddress: '3367 NW 9th St, Corvallis, OR 97330, USA',
    footerMission: 'Our Mission',
    footerBorrowing: 'Borrowing',
    footerInvestments: 'Investments',
    footerContact: 'Contact us',
    footerPolicy: 'Policy',
    footerTerms: 'Our Terms',
    footerLogin: 'Login',
    footerNewAccounts: 'New Accounts',
    copyrightNote: '© All rights reserved',
  };
}

export function sanitizeHomeContent(
  raw: unknown,
  applicationName = 'Our bank',
): TenantHomeContent {
  const defaults = defaultHomeContent(applicationName);
  const row =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const metricsRaw = Array.isArray(row.metrics) ? row.metrics : defaults.metrics;
  const metrics = metricsRaw
    .map(normalizeMetric)
    .filter((m): m is TenantHomeMetric => Boolean(m))
    .slice(0, 6);
  const resolvedMetrics = metrics.length > 0 ? metrics : defaults.metrics;

  return {
    topBarHours: clip(row.topBarHours, MAX_SHORT, defaults.topBarHours),
    tagline: clip(row.tagline, MAX_SHORT, defaults.tagline),
    heroHeadline: clip(row.heroHeadline, MAX_SHORT, defaults.heroHeadline),
    heroSupport: clip(row.heroSupport, MAX_TEXT, defaults.heroSupport),
    navHome: clip(row.navHome, 40, defaults.navHome),
    navAbout: clip(row.navAbout, 40, defaults.navAbout),
    navBanking: clip(row.navBanking, 40, defaults.navBanking),
    navLoans: clip(row.navLoans, 40, defaults.navLoans),
    navInvesting: clip(row.navInvesting, 40, defaults.navInvesting),
    navCards: clip(row.navCards, 40, defaults.navCards),
    navContact: clip(row.navContact, 40, defaults.navContact),
    bankingTitle: clip(row.bankingTitle, MAX_SHORT, defaults.bankingTitle),
    bankingLead: clip(row.bankingLead, MAX_TEXT, defaults.bankingLead),
    bankingBody: clip(row.bankingBody, MAX_TEXT, defaults.bankingBody),
    bankingSecondary: clip(row.bankingSecondary, MAX_TEXT, defaults.bankingSecondary),
    philosophyTitle: clip(row.philosophyTitle, MAX_SHORT, defaults.philosophyTitle),
    philosophyLead: clip(row.philosophyLead, MAX_SHORT, defaults.philosophyLead),
    philosophyBody: clip(row.philosophyBody, MAX_TEXT, defaults.philosophyBody),
    philosophyHighlight: clip(row.philosophyHighlight, MAX_TEXT, defaults.philosophyHighlight),
    whyTitle: clip(row.whyTitle, MAX_SHORT, defaults.whyTitle),
    whySubtitle: clip(row.whySubtitle, MAX_SHORT, defaults.whySubtitle),
    visionTitle: clip(row.visionTitle, MAX_SHORT, defaults.visionTitle),
    visionBody: clip(row.visionBody, MAX_TEXT, defaults.visionBody),
    missionTitle: clip(row.missionTitle, MAX_SHORT, defaults.missionTitle),
    missionBody: clip(row.missionBody, MAX_TEXT, defaults.missionBody),
    philosophySectionTitle: clip(
      row.philosophySectionTitle,
      MAX_SHORT,
      defaults.philosophySectionTitle,
    ),
    philosophySectionBody: clip(
      row.philosophySectionBody,
      MAX_TEXT,
      defaults.philosophySectionBody,
    ),
    metrics: resolvedMetrics,
    aboutTitle: clip(row.aboutTitle, MAX_SHORT, defaults.aboutTitle),
    aboutBody: clip(row.aboutBody, MAX_TEXT, defaults.aboutBody),
    hoursOnline: clip(row.hoursOnline, MAX_SHORT, defaults.hoursOnline),
    hoursSupport: clip(row.hoursSupport, MAX_SHORT, defaults.hoursSupport),
    hoursBranch: clip(row.hoursBranch, MAX_SHORT, defaults.hoursBranch),
    hoursSaturday: clip(row.hoursSaturday, MAX_SHORT, defaults.hoursSaturday),
    headOfficeTitle: clip(row.headOfficeTitle, MAX_SHORT, defaults.headOfficeTitle),
    headOfficeAddress: clip(row.headOfficeAddress, MAX_TEXT, defaults.headOfficeAddress),
    footerMission: clip(row.footerMission, 80, defaults.footerMission),
    footerBorrowing: clip(row.footerBorrowing, 80, defaults.footerBorrowing),
    footerInvestments: clip(row.footerInvestments, 80, defaults.footerInvestments),
    footerContact: clip(row.footerContact, 80, defaults.footerContact),
    footerPolicy: clip(row.footerPolicy, 80, defaults.footerPolicy),
    footerTerms: clip(row.footerTerms, 80, defaults.footerTerms),
    footerLogin: clip(row.footerLogin, 80, defaults.footerLogin),
    footerNewAccounts: clip(row.footerNewAccounts, 80, defaults.footerNewAccounts),
    copyrightNote: clipNullable(row.copyrightNote, MAX_SHORT) ?? defaults.copyrightNote,
  };
}
