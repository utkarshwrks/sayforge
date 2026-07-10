// Poll3 — SAYMAN object-VM contract.
// A 3-option poll (options 0, 1, 2). Each address may vote at most once.
const contract = {
  methods: {
    vote(args) {
      require(args.option >= 0 && args.option <= 2, 'option must be 0, 1, or 2');
      require(!getState('v_' + msg.sender), 'this address already voted');
      setState('v_' + msg.sender, true);
      const key = 'tally_' + args.option;
      setState(key, (getState(key) || 0) + 1);
      emit('VOTE', { by: msg.sender, option: args.option });
      return true;
    },
    tally(_args) {
      return {
        o0: getState('tally_0') || 0,
        o1: getState('tally_1') || 0,
        o2: getState('tally_2') || 0,
      };
    },
  },
};
