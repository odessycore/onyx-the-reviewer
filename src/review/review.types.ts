export type FindingSeverity = 'info' | 'minor' | 'major' | 'critical';

export interface ReviewFinding {
  path: string;
  line: number;
  severity: FindingSeverity;
  title: string;
  body: string;
}

export interface ReviewLlmOutput {
  summary: string;
  intent: string;
  intentAssessment: string;
  confidence: 'low' | 'medium' | 'high';
  findings: ReviewFinding[];
}

export interface PrIntentSignals {
  title: string;
  body: string | null;
  linkedIssues: Array<{ number: number; title: string; body: string | null }>;
  commitMessages: string[];
}
