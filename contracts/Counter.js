// Counter — SAYMAN object-VM contract.
// Anyone can increment the shared counter by a positive amount (default 1).
const contract = {
  methods: {
    inc(args) {
      const by = (args && args.by) || 1;
      require(by > 0, 'by must be > 0');
      const count = getState('count') || 0;
      setState('count', count + by);
      emit('INC', { by, count: count + by });
      return count + by;
    },
    getCount(_args) {
      return getState('count') || 0;
    },
  },
};
