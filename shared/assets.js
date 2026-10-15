// IT Asset Management constants shared by the server and the browser.

export const ASSET_STATUS = {
  in_stock: 'In stock',
  assigned: 'Assigned',
  in_repair: 'In repair',
  retired: 'Retired',
  lost: 'Lost',
};

export const ASSET_CONDITIONS = ['New', 'Good', 'Fair', 'Poor', 'Damaged'];

// Suggestions only; any category can be typed.
export const ASSET_CATEGORIES = ['Laptop', 'Desktop', 'Monitor', 'Mobile phone', 'Tablet', 'Printer', 'Network equipment', 'Server', 'Peripheral', 'Audio-visual', 'Other'];
export const ITEM_CATEGORIES = ['Cables & adapters', 'Peripherals', 'Printer supplies', 'Components', 'Storage media', 'Networking', 'Other'];

export const ASSIGNEE_TYPES = { employee: 'Employee', department: 'Department', location: 'Location' };

// Problem reports that employees file for equipment assigned to them.
export const ISSUE_TYPES = { malfunction: 'Malfunction', damage: 'Physical damage', lost: 'Lost or stolen', other: 'Other problem' };
export const ISSUE_IMPACT = { cannot_work: "Can't work on it", limited: 'Can work, with difficulty', minor: 'Minor, can still work normally' };
export const ISSUE_STATUS = { open: 'New', in_progress: 'Being checked', resolved: 'Resolved', closed: 'Closed' };
export const ACTIVE_ISSUE = ['open', 'in_progress'];
