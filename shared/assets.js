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
