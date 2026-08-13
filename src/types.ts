export type ElectionPhase = 'general' | 'runoff' | 'closed';

export interface User {
  matNumber: string;
  hasVoted: boolean;
  name: string;
  userBallot?: Record<string, string>;
  ballotId?: string;    // anonymous UUID receipt returned after a successful vote
  phase?: ElectionPhase; // which election this user logged in/voted for
}

export interface Candidate {
  id: string;
  name: string;
  manifesto: string;        // fallback plain-text manifesto — always required
  image: string;
  vision?: string;          // optional — a one-line vision statement
  keyPriorities?: string[]; // optional — rendered as a bulleted list
  motto?: string;           // optional — short tagline, styled distinctly
}

export interface ElectionCategory {
  position: string;   // Display name shown on the ballot
  dbKey: string;      // Database column name — never change this once votes are cast
  unopposed: boolean;
  candidates: Candidate[];
}