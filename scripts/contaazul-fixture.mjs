// Synthetic financial data only. No client export belongs in the repository.
export function contaAzulFixture() {
  const title = (row, overrides = {}) => ({
    row,
    A: "",
    B: "Cliente Exemplo",
    I: "Serviço de exemplo",
    D: "01/04/2026",
    E: "07/04/2026",
    M: "100",
    O: "70",
    S: "70",
    T: "30",
    X: "30",
    K: "Parcialmente quitado",
    AC: "Serviços",
    AE: "Operacional",
    ...overrides,
  });
  const movement = (row, overrides = {}) => ({
    row,
    A: "07/04/2026",
    C: "Cliente Exemplo",
    F: "Serviço de exemplo",
    T: "01/04/2026",
    U: "07/04/2026",
    H: "Receita",
    I: "Venda",
    J: "Conta A",
    K: "Pix",
    Y: "Serviços",
    AA: "Operacional",
    N: "Quitado",
    L: "40",
    O: "40",
    ...overrides,
  });
  const books = [
    {
      filename: "receber.xls",
      sha256: "a".repeat(64),
      rows: [
        { M: "Valor original da parcela (R$)" },
        title(2),
        title(3, {
          I: "Serviço desconsiderado",
          M: "50",
          O: "0",
          S: "0",
          T: "0",
          X: "0",
          K: "Perdido/Desconsiderado",
        }),
      ],
    },
    {
      filename: "pagar.xls",
      sha256: "b".repeat(64),
      rows: [
        { M: "Valor original da parcela (R$)" },
        title(2, {
          B: "Fornecedor Exemplo",
          I: "Despesa exemplo",
          M: "20",
          O: "20",
          S: "15",
          T: "0",
          X: "0",
          K: "Quitado",
          AC: "Despesas",
        }),
      ],
    },
    {
      filename: "extrato.xls",
      sha256: "c".repeat(64),
      rows: [
        { A: "Data movimento" },
        movement(2, { I: "Saldo Conta Bancária", A: "01/04/2026", J: "Conta A", L: "500" }),
        movement(3, { I: "Saldo Conta Bancária", A: "01/04/2026", J: "Conta B", L: "0" }),
        movement(4, { L: "45", O: "40", P: "5", N: "Conciliado" }),
        movement(5, { L: "25", O: "30", R: "-5" }),
        movement(6, { L: "30", O: "30", N: "Em aberto" }),
        movement(7, { F: "Serviço desconsiderado", L: "0", O: "50", N: "Perdido/Desconsiderado" }),
        movement(8, {
          C: "Fornecedor Exemplo",
          F: "Despesa exemplo",
          H: "Despesa",
          Y: "Despesas",
          L: "-15",
          O: "-20",
          R: "5",
        }),
        movement(9, {
          I: "Transferência",
          F: "Aplicação de exemplo",
          L: "-100",
          J: "Conta A",
          N: "Conciliado",
        }),
        movement(10, {
          I: "Transferência",
          F: "Aplicação de exemplo",
          L: "100",
          J: "Conta B",
          N: "Transferido",
        }),
      ],
    },
  ];
  const audit = {
    receivable: { sha256: books[0].sha256, count: 2 },
    payable: { sha256: books[1].sha256, count: 1 },
    statement: {
      sha256: books[2].sha256,
      count: 9,
      matching: {
        receivable: { row_mapping: { 2: [4, 5, 6], 3: [7] } },
        payable: { row_mapping: { 2: [8] } },
      },
      opening_balance_rows: [{ row: 2 }, { row: 3 }],
      transfers: { pairs: [{ out_row: 9, in_row: 10 }] },
    },
  };
  return { books, audit };
}
