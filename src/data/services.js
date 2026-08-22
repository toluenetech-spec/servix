/**
 * DEMO DATA — Services catalogue.
 * Replaced by `GET /api/services` when the backend is connected.
 * Prices are in Nigerian Naira (NGN) and are demo values.
 */
export const services = [
  {
    id: 'business-website-development',
    title: 'Business Website Design & Development',
    categoryId: 'web-development',
    professionalId: 'adaeze-okafor',
    rating: 4.9,
    reviewCount: 64,
    price: 450000,
    priceUnit: 'per project',
    duration: '3–4 weeks',
    location: 'Remote',
    availability: 'available',
    image: '/images/services/business-website.jpg',
    gallery: [
      '/images/services/business-website.jpg',
      '/images/services/ecommerce-store.jpg',
      '/images/services/product-ui-design.jpg',
    ],
    shortDescription:
      'A fast, modern, fully responsive website for your business — designed, built and deployed.',
    description:
      'A complete website project from first conversation to launch. We start with your goals and content, agree on a sitemap and design direction, then I design and build a fast, responsive site you can be proud of. Every project includes deployment, basic SEO setup and a handover session so you can manage content yourself.',
    included: [
      'Up to 8 custom-designed pages',
      'Mobile-first responsive build',
      'Content management setup',
      'Basic on-page SEO configuration',
      'Deployment and domain setup',
      'Two rounds of revisions',
      '30 days of post-launch support',
    ],
    requirements: [
      'Your logo and brand assets (if available)',
      'Page content or a content outline',
      'Examples of websites you like',
      'Access to your domain registrar at launch',
    ],
    faqs: [
      {
        q: 'Do you write the website content?',
        a: 'I work with the content you provide. If you need copywriting, I can recommend a writer on Servix and coordinate directly with them.',
      },
      {
        q: 'Can I update the website myself afterwards?',
        a: 'Yes. Every build includes a content management setup and a handover session showing you how to edit pages, images and text.',
      },
      {
        q: 'What if I need more than 8 pages?',
        a: 'Additional pages can be scoped and quoted before the project starts, so there are no surprises mid-way.',
      },
    ],
  },
  {
    id: 'ecommerce-store-build',
    title: 'E-commerce Store Setup & Customization',
    categoryId: 'web-development',
    professionalId: 'adaeze-okafor',
    rating: 4.8,
    reviewCount: 38,
    price: 650000,
    priceUnit: 'per project',
    duration: '4–6 weeks',
    location: 'Remote',
    availability: 'available',
    image: '/images/services/ecommerce-store.jpg',
    gallery: ['/images/services/ecommerce-store.jpg', '/images/services/business-website.jpg'],
    shortDescription:
      'A complete online store with product management, payments-ready checkout and order flows.',
    description:
      'End-to-end e-commerce build: storefront design, product catalogue setup, cart and checkout flows, and integration-ready payment configuration. Built for speed and conversion, with an admin workflow your team can actually operate day to day.',
    included: [
      'Custom storefront design',
      'Product catalogue setup (up to 50 products)',
      'Cart and checkout flows',
      'Payment gateway configuration',
      'Order management setup',
      'Staff training session',
      '30 days of post-launch support',
    ],
    requirements: [
      'Product list with images and prices',
      'Business registration details for payment setup',
      'Shipping and returns policy',
    ],
    faqs: [
      {
        q: 'Which payment providers do you support?',
        a: 'I configure the store for the local and international providers you choose during scoping. Provider fees are separate from the project price.',
      },
      {
        q: 'Can you migrate my existing store?',
        a: 'Yes — product and customer migration from an existing platform can be included after a short review of your current setup.',
      },
    ],
  },
  {
    id: 'product-ui-design',
    title: 'Product UI Design (Web or Mobile App)',
    categoryId: 'ui-ux-design',
    professionalId: 'chiamaka-eze',
    rating: 4.9,
    reviewCount: 47,
    price: 380000,
    priceUnit: 'per project',
    duration: '2–3 weeks',
    location: 'Remote',
    availability: 'available',
    image: '/images/services/product-ui-design.jpg',
    gallery: ['/images/services/product-ui-design.jpg', '/images/services/design-system.jpg'],
    shortDescription:
      'Developer-ready interface design for your web or mobile product, from flows to final screens.',
    description:
      'Complete interface design for a focused product scope: user flows, wireframes, high-fidelity screens and a developer handoff package. I design in Figma with organised components, so your engineering team gets files they can actually build from.',
    included: [
      'User flows for the agreed scope',
      'Wireframes for key screens',
      'Up to 15 high-fidelity screens',
      'Interactive prototype',
      'Developer handoff documentation',
      'Two rounds of revisions',
    ],
    requirements: [
      'A product brief or feature list',
      'Access to any existing designs or brand assets',
      'One stakeholder available for weekly reviews',
    ],
    faqs: [
      {
        q: 'Do you also do user research?',
        a: 'Light validation is included. Full research studies (interviews, usability testing) can be scoped as an extension.',
      },
      {
        q: 'What do developers receive at handoff?',
        a: 'An organised Figma file with components, spacing annotations, exported assets and a short walkthrough call.',
      },
    ],
  },
  {
    id: 'design-system-setup',
    title: 'Design System Setup for Product Teams',
    categoryId: 'ui-ux-design',
    professionalId: 'chiamaka-eze',
    rating: 4.8,
    reviewCount: 22,
    price: 520000,
    priceUnit: 'per project',
    duration: '3–4 weeks',
    location: 'Remote',
    availability: 'limited',
    image: '/images/services/design-system.jpg',
    gallery: ['/images/services/design-system.jpg', '/images/services/product-ui-design.jpg'],
    shortDescription:
      'A practical, documented design system your product and engineering teams will actually use.',
    description:
      'I audit your current product, define tokens and components, and deliver a documented Figma design system with usage guidelines. Built to match how your engineering team works, not as a theoretical exercise.',
    included: [
      'Interface audit of your current product',
      'Design tokens (color, type, spacing)',
      'Core component library in Figma',
      'Usage documentation',
      'Team walkthrough session',
    ],
    requirements: [
      'Access to your current product and design files',
      'A short call with your engineering lead',
    ],
    faqs: [
      {
        q: 'Do you build the coded component library too?',
        a: 'This service covers the design side. I can coordinate with a developer on Servix if you need the coded library as well.',
      },
    ],
  },
  {
    id: 'brand-identity-package',
    title: 'Complete Brand Identity Package',
    categoryId: 'graphic-design',
    professionalId: 'tunde-bakare',
    rating: 4.9,
    reviewCount: 71,
    price: 350000,
    priceUnit: 'per project',
    duration: '2–3 weeks',
    location: 'Remote',
    availability: 'available',
    image: '/images/services/brand-identity.jpg',
    gallery: ['/images/services/brand-identity.jpg', '/images/services/graphic-design-2.jpg'],
    shortDescription:
      'Logo, color system, typography and brand guidelines — a complete identity built to last.',
    description:
      'A full identity project: discovery workshop, logo design with revisions, color and typography systems, and a practical brand guideline document. You receive every file format you will ever be asked for, organised and labelled.',
    included: [
      'Discovery workshop',
      'Logo design (3 initial concepts)',
      'Color palette and typography system',
      'Brand guidelines document',
      'Stationery designs (letterhead, business card)',
      'All source files and exports',
    ],
    requirements: [
      'A completed brand questionnaire (provided)',
      'Examples of brands you admire',
      'Decision-maker present at reviews',
    ],
    faqs: [
      {
        q: 'How many revision rounds are included?',
        a: 'Three rounds on the chosen concept. Additional rounds are quoted transparently before any work continues.',
      },
      {
        q: 'Who owns the final designs?',
        a: 'You do. Full ownership of the final identity transfers to you on final payment, with all source files included.',
      },
    ],
  },
  {
    id: 'product-photography-session',
    title: 'Product Photography Session',
    categoryId: 'photography',
    professionalId: 'emeka-nwosu',
    rating: 4.8,
    reviewCount: 41,
    price: 180000,
    priceUnit: 'per session',
    duration: '1 day + 5 days delivery',
    location: 'Port Harcourt & Lagos',
    availability: 'limited',
    image: '/images/services/product-photography.jpg',
    gallery: ['/images/services/product-photography.jpg', '/images/services/event-photography.jpg'],
    shortDescription:
      'Studio-quality product photography for e-commerce, catalogues and campaigns.',
    description:
      'A full product shoot with professional lighting, styling guidance and post-production. Ideal for e-commerce stores, lookbooks and advertising. I shoot in studio or on location and deliver retouched, web-ready and print-ready files.',
    included: [
      'Up to 20 products photographed',
      '3 angles per product',
      'Professional retouching',
      'White background + lifestyle setups',
      'Web and print resolution exports',
    ],
    requirements: [
      'Products delivered 2 days before the shoot',
      'A shot list or product priority order',
      'Brand guidelines if styling should match',
    ],
    faqs: [
      {
        q: 'Can you shoot at my location?',
        a: 'Yes, within Port Harcourt and Lagos. Travel within these cities is included; other locations are quoted separately.',
      },
    ],
  },
  {
    id: 'event-photography-coverage',
    title: 'Corporate Event Photography Coverage',
    categoryId: 'photography',
    professionalId: 'emeka-nwosu',
    rating: 4.7,
    reviewCount: 29,
    price: 250000,
    priceUnit: 'per day',
    duration: '1 day + 7 days delivery',
    location: 'Port Harcourt & Lagos',
    availability: 'limited',
    image: '/images/services/event-photography.jpg',
    gallery: ['/images/services/event-photography.jpg', '/images/services/product-photography.jpg'],
    shortDescription:
      'Full-day professional coverage for conferences, launches and corporate events.',
    description:
      'Complete event coverage from setup to closing remarks: keynotes, panels, candid moments and branded details. Includes a same-day highlights selection for your social channels and the full edited gallery within a week.',
    included: [
      'Up to 8 hours of coverage',
      'Same-day highlights (15 images)',
      'Full edited gallery (300+ images)',
      'Online gallery for sharing',
      'Commercial usage rights',
    ],
    requirements: [
      'Event schedule and key moments list',
      'Venue access 1 hour before start',
      'A point of contact on the day',
    ],
    faqs: [
      {
        q: 'Do you cover multi-day events?',
        a: 'Yes. Each additional day is billed at the day rate with a discount agreed during booking.',
      },
    ],
  },
  {
    id: 'marketing-strategy-sprint',
    title: 'Marketing Strategy Sprint',
    categoryId: 'marketing',
    professionalId: 'funmi-adeyemi',
    rating: 4.8,
    reviewCount: 33,
    price: 300000,
    priceUnit: 'per engagement',
    duration: '2 weeks',
    location: 'Remote',
    availability: 'available',
    image: '/images/services/marketing-strategy.jpg',
    gallery: ['/images/services/marketing-strategy.jpg', '/images/services/seo-audit.jpg'],
    shortDescription:
      'A focused two-week engagement producing a practical, prioritised marketing plan.',
    description:
      'A structured sprint: audit of your current marketing, customer and competitor research, channel strategy and a 90-day action plan with budgets and expected outcomes. You leave with a plan your team can execute immediately — with or without me.',
    included: [
      'Marketing and analytics audit',
      'Customer and competitor research',
      'Channel strategy and budget allocation',
      '90-day prioritised action plan',
      'Two working sessions with your team',
    ],
    requirements: [
      'Access to your analytics and ad accounts',
      'A short intake questionnaire',
      'Your team available for two workshops',
    ],
    faqs: [
      {
        q: 'Can you also execute the plan?',
        a: 'Yes — ongoing execution can be arranged as a separate monthly engagement after the sprint.',
      },
    ],
  },
  {
    id: 'seo-audit-roadmap',
    title: 'SEO Audit & Growth Roadmap',
    categoryId: 'marketing',
    professionalId: 'funmi-adeyemi',
    rating: 4.7,
    reviewCount: 26,
    price: 200000,
    priceUnit: 'per engagement',
    duration: '1–2 weeks',
    location: 'Remote',
    availability: 'available',
    image: '/images/services/seo-audit.jpg',
    gallery: ['/images/services/seo-audit.jpg', '/images/services/marketing-strategy.jpg'],
    shortDescription:
      'A deep technical and content SEO audit with a prioritised roadmap to grow organic traffic.',
    description:
      'Full technical, content and authority audit of your website with a clear, prioritised roadmap. Every recommendation includes the why, the how and the expected impact — written for both marketers and developers.',
    included: [
      'Technical SEO audit',
      'Content and keyword gap analysis',
      'Competitor benchmarking',
      'Prioritised 6-month roadmap',
      'Walkthrough call with your team',
    ],
    requirements: [
      'Access to Search Console and analytics',
      'A list of your priority products or services',
    ],
    faqs: [
      {
        q: 'Will you implement the fixes?',
        a: 'The audit is implementation-ready for your team. Hands-on implementation can be scoped separately.',
      },
    ],
  },
  {
    id: 'promo-video-editing',
    title: 'Promotional Video Editing & Motion Graphics',
    categoryId: 'video-editing',
    professionalId: 'ibrahim-musa',
    rating: 4.9,
    reviewCount: 35,
    price: 150000,
    priceUnit: 'per video',
    duration: '1–2 weeks',
    location: 'Remote',
    availability: 'available',
    image: '/images/services/video-editing.jpg',
    gallery: ['/images/services/video-editing.jpg'],
    shortDescription:
      'Broadcast-quality editing, color grading and motion graphics for your promotional content.',
    description:
      'Professional post-production for promotional videos up to three minutes: editing, color grading, sound design, subtitles and custom motion graphics. Delivered in every format and aspect ratio you need for web, social and broadcast.',
    included: [
      'Editing for videos up to 3 minutes',
      'Color grading and sound design',
      'Custom motion graphics and titles',
      'Subtitles',
      'All aspect ratios (16:9, 1:1, 9:16)',
      'Two rounds of revisions',
    ],
    requirements: [
      'Raw footage via cloud transfer',
      'Brand assets and any music preferences',
      'A reference video or storyboard if available',
    ],
    faqs: [
      {
        q: 'Do you source licensed music?',
        a: 'Yes — I work with licensed libraries and include the licence documentation with your delivery.',
      },
    ],
  },
  {
    id: 'website-copywriting',
    title: 'Website Copywriting (Up to 6 Pages)',
    categoryId: 'writing',
    professionalId: 'ngozi-umeh',
    rating: 4.8,
    reviewCount: 31,
    price: 160000,
    priceUnit: 'per project',
    duration: '1–2 weeks',
    location: 'Remote',
    availability: 'available',
    image: '/images/services/copywriting.jpg',
    gallery: ['/images/services/copywriting.jpg'],
    shortDescription:
      'Clear, persuasive website copy that sounds like your business — not a template.',
    description:
      'Complete website copy for up to six pages, from homepage to contact. The process starts with a voice and messaging workshop, then I write, you review, and we refine until every page earns its place. SEO-aware without sounding like it was written for robots.',
    included: [
      'Voice and messaging workshop',
      'Copy for up to 6 pages',
      'SEO keyword integration',
      'Meta titles and descriptions',
      'Two rounds of revisions',
    ],
    requirements: [
      'A completed brand questionnaire (provided)',
      'Access to any existing copy or brand documents',
      'Sitemap or page list',
    ],
    faqs: [
      {
        q: 'Do you work with my designer or developer?',
        a: 'Happily. I deliver copy in a structured document mapped to your page layouts and stay available during the build.',
      },
    ],
  },
  {
    id: 'business-strategy-session',
    title: 'Business Strategy & Operations Review',
    categoryId: 'consulting',
    professionalId: 'dayo-ogunleye',
    rating: 4.7,
    reviewCount: 19,
    price: 350000,
    priceUnit: 'per engagement',
    duration: '2–3 weeks',
    location: 'Lagos or Remote',
    availability: 'limited',
    image: '/images/services/consulting.jpg',
    gallery: ['/images/services/consulting.jpg'],
    shortDescription:
      'A structured review of your business with practical, prioritised recommendations.',
    description:
      'A hands-on engagement for small and mid-sized businesses: I review your operations, finances and market position, then deliver a prioritised set of recommendations with an implementation plan. Practical advice you can act on the following Monday.',
    included: [
      'Operations and process review',
      'Financial health assessment',
      'Market position analysis',
      'Prioritised recommendations report',
      'Implementation planning session',
      '30-day follow-up call',
    ],
    requirements: [
      'Access to key financial statements',
      'Interviews with 2–3 team members',
      'A signed confidentiality agreement (provided)',
    ],
    faqs: [
      {
        q: 'Is my business information kept confidential?',
        a: 'Yes. Every engagement starts with a mutual confidentiality agreement before any documents are shared.',
      },
    ],
  },
];
