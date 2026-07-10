// TipJar — SAYMAN object-VM contract.
// Anyone can tip; the pot accrues. The first tipper becomes owner and can withdraw.
// Amounts are integer base units (1 SAYN = 100,000,000).
const contract = {
  methods: {
    tip(args) {
      require(args.amount > 0, 'amount must be > 0');
      const pot = getState('pot') || 0;
      setState('pot', pot + args.amount);
      if (!getState('owner')) setState('owner', msg.sender);
      emit('TIP', { by: msg.sender, amount: args.amount });
      return pot + args.amount;
    },
    withdraw(_args) {
      require(msg.sender === getState('owner'), 'only owner may withdraw');
      const pot = getState('pot') || 0;
      setState('pot', 0);
      transfer(msg.sender, pot);
      emit('WITHDRAW', { to: msg.sender, amount: pot });
      return pot;
    },
    getPot(_args) {
      return getState('pot') || 0;
    },
    getOwner(_args) {
      return getState('owner') || null;
    },
  },
};
