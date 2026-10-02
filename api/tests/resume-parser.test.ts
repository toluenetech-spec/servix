import { describe, it, expect } from 'vitest';
import { parseResumeText } from '../src/lib/resumeParser.js';

const linkedIn = `Contact
adaeze@example.com
www.linkedin.com/in/adaeze-okafor (LinkedIn)
Top Skills
React
Node.js
PostgreSQL
Languages
English (Native or Bilingual)
Igbo (Professional Working)
Certifications
AWS Certified Developer – Associate
Adaeze Okafor
Senior Web Developer building production e-commerce platforms
Lagos, Nigeria
Summary
I build fast, accessible web applications for growing businesses.
Ten years across agencies and product teams.
Experience
Brightline Studio
Senior Web Developer
Mar 2021 - Present (3 years)
Lagos, Nigeria
Lead developer on retail storefronts and internal tools.
Mentor three junior engineers.
Kobo Labs
Frontend Developer
Jan 2018 - Feb 2021 (3 years 2 months)
Built dashboards for fintech clients.
Education
University of Lagos
Bachelor of Science (B.Sc.), Computer Science · (2012 - 2016)
Page 1 of 1`;

const plainCv = `ADAEZE OKAFOR
Brand & Graphic Designer
Ibadan, Oyo State | adaeze@example.com | https://adaeze.design

PROFILE
Creative designer with eight years of experience shaping brand identities for SMEs.

SKILLS
Adobe Illustrator, Photoshop, Figma, Brand Strategy, Typography

WORK EXPERIENCE
Lead Designer | Orange Pixel Agency | 2020 – Present
Directed identity projects for 40+ clients across Nigeria.
Graphic Designer, Printhouse Ltd, 2016 - 2020
Produced print and packaging artwork.

EDUCATION
Obafemi Awolowo University
B.A. Fine and Applied Arts, 2011 - 2015

CERTIFICATIONS
Google UX Design Professional Certificate - Coursera (2022)

LANGUAGES
English, Yoruba`;

describe('resume parser', () => {
  it('reads a LinkedIn "Save to PDF" export', () => {
    const r = parseResumeText(linkedIn, 'Adaeze Okafor');
    expect(r.source).toBe('linkedin');
    expect(r.title).toBe('Senior Web Developer building production e-commerce platforms');
    expect(r.locationCity).toBe('Lagos');
    expect(r.about).toContain('fast, accessible web applications');
    expect(r.skills).toEqual(['React', 'Node.js', 'PostgreSQL']);
    expect(r.languages).toEqual([{ name: 'English', level: 'Native or Bilingual' }, { name: 'Igbo', level: 'Professional Working' }]);
    expect(r.certifications[0].name).toContain('AWS Certified Developer');
    expect(r.education[0]).toMatchObject({ school: 'University of Lagos', year: '2012 - 2016' });
    expect(r.education[0].degree).toContain('Computer Science');
    expect(r.experience).toHaveLength(2);
    expect(r.experience[0]).toMatchObject({ title: 'Senior Web Developer', company: 'Brightline Studio', start: 'Mar 2021', end: 'Present' });
    expect(r.experience[0].description).toContain('Lead developer');
    expect(r.experience[0].description).not.toContain('Kobo Labs');
    expect(r.experience[1]).toMatchObject({ title: 'Frontend Developer', company: 'Kobo Labs', end: 'Feb 2021' });
    expect(r.website).toBe('');
    expect(r.found).toEqual(expect.arrayContaining(['title', 'about', 'skills', 'experience', 'education']));
  });

  it('reads an ordinary CV with conventional headings', () => {
    const r = parseResumeText(plainCv, 'Adaeze Okafor');
    expect(r.source).toBe('cv');
    expect(r.title).toBe('Brand & Graphic Designer');
    expect(r.locationCity).toBe('Ibadan');
    expect(r.website).toBe('https://adaeze.design');
    expect(r.about).toContain('eight years');
    expect(r.skills).toEqual(['Adobe Illustrator', 'Photoshop', 'Figma', 'Brand Strategy', 'Typography']);
    expect(r.experience[0]).toMatchObject({ title: 'Lead Designer', company: 'Orange Pixel Agency', start: '2020', end: 'Present' });
    expect(r.experience[1]).toMatchObject({ title: 'Graphic Designer', company: 'Printhouse Ltd', start: '2016', end: '2020' });
    expect(r.education[0]).toMatchObject({ school: 'Obafemi Awolowo University', year: '2011 - 2015' });
    expect(r.certifications[0]).toMatchObject({ name: 'Google UX Design Professional Certificate', issuer: 'Coursera', year: '2022' });
    expect(r.languages.map((l) => l.name)).toEqual(['English', 'Yoruba']);
  });

  it('never throws on unstructured text and reports nothing found', () => {
    const r = parseResumeText('lorem ipsum dolor sit amet', 'Someone Else');
    expect(r.found).toEqual([]);
    expect(r.skills).toEqual([]);
    expect(r.experience).toEqual([]);
  });
});
