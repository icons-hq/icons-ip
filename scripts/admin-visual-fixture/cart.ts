const blocked = () => { throw new Error('fixture blocks cart writes'); };
export const useCart = () => ({ items: [], count: 0, ready: true, mode: 'server', pending: false, error: null,
  getQuantity: () => 0, add: blocked, setQuantity: blocked, remove: blocked, refresh: blocked, resetForSignOut: blocked,
});
