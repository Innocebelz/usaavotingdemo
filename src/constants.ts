import { ElectionCategory } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// DEMO ELECTION DATA — NorthSetif University Student Council (fictional)
//
// This is a drop-in replacement for constants.ts, used ONLY in the demo
// deployment. Rename this file to constants.ts in your demo repo/branch.
//
// Every `dbKey` and candidate `id` below is IDENTICAL to the production
// file — that's what keeps the backend, the runoff logic, and the demo
// reset script working with zero changes. Only names, mottos, manifestos,
// and images were swapped for fictional ones (ui-avatars.com generates a
// clean placeholder avatar from initials — no real photos of anyone).
// ─────────────────────────────────────────────────────────────────────────────

const avatar = (name: string, bg = '18181b', fg = 'eab308') =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=${bg}&color=${fg}&size=256&bold=true`;

export const ELECTION_DATA: ElectionCategory[] = [

  // ── 1. PRESIDENT ──────────────────────────────────────────────────────────
  {
    position: 'President',
    dbKey: 'president',
    unopposed: false,
    candidates: [
      {
        id: 'pres_1',
        name: 'Jordan Ashworth',
        image: avatar('Jordan Ashworth'),
        manifesto:
            'Committed to serving students through strong leadership, prioritizing welfare, promoting unity, ensuring accountability, and representing every student effectively.',
        motto: '#Chief Servant',
        keyPriorities: [
          'Promote a culture of service to all students.',
          'Prioritize student welfare and well-being.',
          'Strengthen unity among the student body.',
          'Ensure effective and timely communication.',
          'Uphold transparency and accountability in leadership.',
          'Represent students’ interests with integrity and commitment.',
        ],
      },
      {
        id: 'pres_2',
        name: 'Priya Nandakumar',
        image: avatar('Priya Nandakumar'),
        manifesto:
            'Committed to putting students first through strong welfare support, academic and career development, transparent leadership, innovation, and campus-wide unity.',
        motto: 'For All, Together',
        keyPriorities: [
          'Prioritize student welfare through advocacy and emergency support funds.',
          'Promote career growth, mentorship, internships, and networking opportunities.',
          'Advance academic excellence through scholarships, research, and recognition.',
          'Support orientation and integration for newly arrived students.',
          'Strengthen unity through sports, cultural, and social activities.',
          'Ensure transparent communication through regular updates and student feedback.',
          'Expand outreach across every campus faculty.',
          'Promote skills development, innovation, and entrepreneurship initiatives.',
          'Support a student-run savings and emergency-support cooperative.',
          'Prepare graduating students for life after university.',
        ],
      },
      {
        id: 'pres_3',
        name: 'Malik Osei',
        image: avatar('Malik Osei'),
        manifesto:
            'Committed to building a student-centred council through transparent leadership, effective communication, student welfare, academic excellence, and unity.',
        motto: 'Progress Guided by Your Voice',
        keyPriorities: [
          'Build a truly student-centred council where every voice matters.',
          'Promote transparent and accountable leadership.',
          'Ensure effective communication and information sharing.',
          'Strengthen student welfare and support systems.',
          'Guarantee equal representation and participatory leadership.',
          'Promote academic excellence and personal development.',
          'Build strong institutions for lasting impact.',
          'Foster unity and inclusiveness among all students.',
          'Strengthen professional representation and strategic partnerships.',
          'Lead with integrity, humility, and a spirit of service.',
        ],
      },
    ],
  },

  // ── 2. MALE VICE PRESIDENT ────────────────────────────────────────────────
  {
    position: 'Male Vice President',
    dbKey: 'male_vice_president',
    unopposed: false,
    candidates: [
      {
        id: 'mvp_1',
        name: 'Elias Novak',
        image: avatar('Elias Novak'),
        manifesto:
            'Committed to promoting unity, advancing student welfare, supporting career growth, and strengthening networking opportunities while ensuring effective communication and student integration.',
        motto: 'Unity, Support & Opportunity.',
        keyPriorities: [
          'Promote unity among all students.',
          'Advocate for student welfare and represent students’ interests.',
          'Provide career support and mentorship opportunities.',
          'Promote networking among students, alumni, and professionals.',
          'Facilitate orientation and smooth integration for new students.',
          'Advocate for further study opportunities and academic progression.',
          'Assist in organizing social events and council meetings.',
          'Ensure effective and timely communication with students.',
        ],
      },
      {
        id: 'mvp_2',
        name: 'Dario Fontaine',
        image: avatar('Dario Fontaine'),
        manifesto: 'A united student community across every campus.',
        vision: 'A united student community across every campus.',
        keyPriorities: [
          'Representation: Ensure every student\'s voice is heard and valued.',
          'Student Welfare: Strengthen support systems for academic and personal well-being.',
          'Unity: Foster stronger connections among students across all faculties.',
          'Accountability: Promote transparent, responsive, and service-driven leadership.',
        ],
        motto: 'Built by All, For All.',
      },
    ],
  },

  // ── 3. FEMALE VICE PRESIDENT ──────────────────────────────────────────────
  {
    position: 'Female Vice President',
    dbKey: 'female_vice_president',
    unopposed: true, // UNOPPOSED - 50% Rule Applies
    candidates: [
      {
        id: 'fvp_1',
        name: 'Anaya Okonkwo',
        image: avatar('Anaya Okonkwo'),
        manifesto: 'Leading with action, unity, and accountability through inclusive student representation and open communication.',
        motto: 'Leading with Action, Unity & Accountability.',
        keyPriorities: [
          'Course-based orientation open to every student.',
          'Introduce an anonymous digital suggestion box.',
          'Organise get-together activities to promote inclusion.',
        ],
      },
    ],
  },

  // ── 4. MINISTER OF FINANCE ────────────────────────────────────────────────
  {
    position: 'Minister of Finance',
    dbKey: 'minister_of_finance',
    unopposed: true, // UNOPPOSED - 50% Rule Applies
    candidates: [
      {
        id: 'mfin_1',
        name: 'Tobias Reyes',
        image: avatar('Tobias Reyes'),
        manifesto:
            'Committed to strengthening students’ financial welfare through accountability, sustainable funding initiatives, and transparent financial management.',
        motto: 'Building Financial Security Through Accountability.',
        keyPriorities: [
          'Expand faculty-based savings cooperatives and strengthen emergency funding.',
          'Ensure rigorous budget follow-up and reconciliation.',
          'Promote productive student investment through council subscriptions.',
          'Support surplus budgeting, student loans, and circular funding.',
          'Provide financial counselling and establish a student feedback system.',
        ],
      },
    ],
  },

  // ── 5. MINISTER OF EDUCATION AND SPORTS ───────────────────────────────────
  {
    position: 'Minister of Education and Sports',
    dbKey: 'minister_of_education',
    unopposed: false,
    candidates: [
      {
        id: 'medu_1',
        name: 'Samuel Petit',
        image: avatar('Samuel Petit'),
        manifesto: 'Ensuring equal opportunities for all, creating talk shows and debates, promoting access to study materials, bridging the student-academic board gap, inclusive co-curriculars, mentorship programs, and diverse sports participation.',
        motto: 'Integrity and visionary leadership for all',
        keyPriorities: [
          'Ensuring that everyone gets equal opportunities, without selection.',
          'Creating talk shows, debates, and public speaking opportunities.',
          'Promoting easy access to study materials for all members.',
          'Bridging the gap between students and the academic board.',
          'Ensuring nobody is left behind in terms of co-curriculars.',
          'Organizing mentorship programs aligned to each student\'s career path.',
          'Creating a diverse platform where every sport is exercised and participated in.',
        ],
      },
      {
        id: 'medu_2',
        name: 'Freya Lindqvist',
        image: avatar('Freya Lindqvist'),
        manifesto:
            'Dedicated to promoting academic excellence, expanding student opportunities, and creating an inclusive environment through sports, talent development, and global connections.',
        motto: 'Excellence, Opportunity & Inclusion.',
        keyPriorities: [
          'Promote academic excellence through student-focused initiatives.',
          'Expand quiz competitions to encourage academic participation.',
          'Organize inter-faculty sports competitions to strengthen student interaction.',
          'Introduce online competitions to increase accessibility and engagement.',
          'Support talent development by providing platforms for students to showcase their abilities.',
          'Strengthen global student connections while promoting inclusive engagement.',
        ],
      },
      {
        id: 'medu_3',
        name: 'Renato Alcantara',
        image: avatar('Renato Alcantara'),
        manifesto:
            'Committed to advancing academic excellence, expanding sports and co-curricular opportunities, strengthening administrative support, and building lasting alumni networks to empower every student.',
        motto: 'Empowering Students Through Excellence, Opportunity & Unity.',
        keyPriorities: [
          'Establish strategic peer-led mentorship networks to enhance academic success.',
          'Provide comprehensive language support systems for international students.',
          'Introduce prestigious academic recognition and excellence awards.',
          'Develop clear industrial training and internship roadmaps for students.',
          'Expand sports and co-curricular activities, including basketball, swimming, and athletics.',
          'Strengthen administrative advocacy and foster active alumni engagement.',
        ],
      },
    ],
  },

  // ── 6. GENERAL SECRETARY ──────────────────────────────────────────────────
  {
    position: 'General Secretary',
    dbKey: 'general_secretary',
    unopposed: true, // UNOPPOSED - 50% Rule Applies
    candidates: [
      {
        id: 'gsec_1',
        name: 'Camille Duval',
        image: avatar('Camille Duval'),
        manifesto:
            'Committed to fostering effective communication, strengthening student representation, promoting transparency and accountability, and building a united and inclusive campus community.',
        motto: 'Unity Through Communication and Accountability.',
        keyPriorities: [
          'Promote effective and timely communication between the council and students.',
          'Strengthen student representation by ensuring students’ voices are heard.',
          'Uphold transparency and accountability in all council activities.',
          'Foster unity and inclusion by creating an environment where every student feels valued.',
        ],
      },
    ],
  },

  // ── 7. MINISTER OF INFORMATION AND PUBLICITY ──────────────────────────────
  {
    position: 'Minister of Information and Publicity',
    dbKey: 'minister_of_information',
    unopposed: true, // UNOPPOSED - 50% Rule Applies
    candidates: [
      {
        id: 'minf_1',
        name: 'Theo Marchetti',
        image: avatar('Theo Marchetti'),
        manifesto: 'Ensuring timely communication, a centralized digital information hub, professional council branding, a regular newsletter, stronger student engagement, and transparency and accountability.',
        motto: 'For Clear Communication, Transparency & Progress.',
        keyPriorities: [
          'Ensure timely and accurate communication for all students.',
          'Create a centralized digital information hub for official updates and opportunities.',
          'Promote a professional council image through quality branding and media.',
          'Launch a regular digital newsletter.',
          'Strengthen student feedback and engagement.',
          'Uphold transparency, accountability, and unity across the council.',
        ],
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// RUNOFF ELECTION (DEMO) — mirrors the production runoff exactly: President
// and Minister of Education both "failed" the 50% threshold in round one,
// so the runoff covers those 2 positions between their top 2 candidates.
// ─────────────────────────────────────────────────────────────────────────────

export const RUNOFF_ADVANCING_IDS: Record<string, string[]> = {
  president:              ['pres_1', 'pres_3'],   // Jordan Ashworth vs Malik Osei
  minister_of_education:  ['medu_2', 'medu_3'],   // Freya Lindqvist vs Renato Alcantara
};

export const RUNOFF_ELECTION_DATA: ElectionCategory[] = Object.entries(RUNOFF_ADVANCING_IDS)
  .map(([dbKey, advancingIds]) => {
    const category = ELECTION_DATA.find(c => c.dbKey === dbKey);
    if (!category) return null;
    return {
      ...category,
      unopposed: false,
      candidates: category.candidates.filter(c => advancingIds.includes(c.id)),
    };
  })
  .filter((c): c is ElectionCategory => c !== null);
