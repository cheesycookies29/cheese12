// Feedback any signed-in user sends to the administrators. Shared by the server and the browser.

export const FEEDBACK_TYPES = {
  bug: 'Bug or error',
  idea: 'Suggestion',
  question: 'Question',
  praise: 'Compliment',
  other: 'Other',
};

export const FEEDBACK_AREAS = {
  general: 'General / whole system',
  hr: 'HR & Payroll',
  assets: 'IT Asset Management',
};

export const FEEDBACK_STATUS = {
  new: 'New',
  reviewing: 'Under review',
  planned: 'Planned',
  resolved: 'Resolved',
  closed: 'Closed',
};

// Statuses still waiting on an administrator.
export const OPEN_FEEDBACK = ['new', 'reviewing', 'planned'];
