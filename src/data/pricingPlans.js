/**
 * DEMO DATA — Professional subscription plans.
 * Placeholder pricing, clearly marked as subject to change on the page.
 * Replaced by `GET /api/plans` when backend billing is connected.
 */
export const pricingPlans = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Basic professional presence.',
    price: 0,
    period: 'forever',
    cta: 'Get Started',
    highlighted: false,
    features: [
      'Professional profile page',
      'Up to 2 service listings',
      'Standard search placement',
      'Booking requests',
      'Customer messaging',
      'Basic profile statistics',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    tagline: 'More tools and visibility for growing practices.',
    price: 15000,
    period: 'per month',
    cta: 'Start Professional',
    highlighted: true,
    features: [
      'Everything in Free',
      'Up to 10 service listings',
      'Priority search placement',
      'Portfolio gallery',
      'Calendar and availability tools',
      'Detailed performance analytics',
      'Verified badge eligibility',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'Advanced features for teams and studios.',
    price: 40000,
    period: 'per month',
    cta: 'Contact Us',
    highlighted: false,
    features: [
      'Everything in Professional',
      'Unlimited service listings',
      'Team member accounts',
      'Featured placement opportunities',
      'Advanced booking management',
      'Dedicated support',
      'Custom profile branding',
    ],
  },
];
