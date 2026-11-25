export type UpdateWorkspace = "marketing" | "consultoria";
export type UpdatePreviewKind =
  | "magalhaes-finance-scroll-fix"
  | "magalhaes-proposal-trash"
  | "crm-free-columns"
  | "magalhaes-finance-plan-filter"
  | "magalhaes-finance-shortcuts"
  | "claude-reads-scanned-files"
  | "magalhaes-task-list-actions"
  | "magalhaes-client-tabs"
  | "magalhaes-client-directory"
  | "magalhaes-reconciliation-guide"
  | "magalhaes-finance-month"
  | "magalhaes-finance-export"
  | "magalhaes-bank-reconciliation"
  | "magalhaes-finance-recurrence"
  | "magalhaes-contaazul-history"
  | "crm-commercial-report"
  | "magalhaes-finance-dashboard"
  | "magalhaes-sicoob-boletos"
  | "magalhaes-sicoob"
  | "magalhaes-proposal-retainer"
  | "crm-column-order"
  | "magalhaes-quote-proposal-crm"
  | "magalhaes-finance-orders"
  | "magalhaes-office-finance"
  | "claude-connect-documents"
  | "magalhaes-top-glass-nav"
  | "claude-connector"
  | "magalhaes-process-navigation"
  | "magalhaes-clean-documents"
  | "magalhaes-client-files-fast"
  | "magalhaes-all-tasks"
  | "magalhaes-active-nav"
  | "magalhaes-client-single"
  | "magalhaes-task-neon"
  | "magalhaes-direct-users"
  | "magalhaes-password"
  | "magalhaes-neon"
  | "magalhaes-local"
  | "magalhaes-brand"
  | "subtask-attachment-indicator"
  | "subtask-file-thumbnails"
  | "subtask-dragged-images"
  | "automatic-safe-update"
  | "subtask-pasted-prints"
  | "client-calendar-references"
  | "agenda-google-compact-actions"
  | "agenda-google-connection-layout"
  | "reports-period-layout"
  | "mobile-client-cards"
  | "dashboard-mobile-metrics"
  | "mobile-obligations-metrics"
  | "mobile-task-toolbar"
  | "dashboard-filter-panel"
  | "team-distribution-labels"
  | "compact-environments-mobile"
  | "animated-sidebar"
  | "recent-update-history"
  | "sidebar-control-footer"
  | "mobile-layout"
  | "meeting-delete-history"
  | "collaborator-sync"
  | "client-important-dates"
  | "member-team-dashboard"
  | "report-subtask-metrics"
  | "meeting-empty-close"
  | "meeting-auto-complete"
  | "permission-save"
  | "permission-nav-order"
  | "crm-avatar-aligned"
  | "crm-without-contact"
  | "crm-company-labels"
  | "crm-company"
  | "crm-columns"
  | "crm-pipeline"
  | "subtask-participation"
  | "calendar-subtask-dates"
  | "update-one-click"
  | "update-retry"
  | "assignment-popup-read"
  | "update-shortcut"
  | "calendar-subtasks"
  | "update-flow"
  | "task-card-activity"
  | "task-edit"
  | "calendar-reschedule"
  | "links-calendar"
  | "task-prints"
  | "dashboard";
export type AppUpdate = {
  id: string;
  title: string;
  date: string;
  preview: UpdatePreviewKind;
  audience: "all" | "admin";
  workspaces: readonly UpdateWorkspace[];
  details: readonly string[];
};

// Keep newest first. The first visible entry determines the update notice and
// acknowledgement key, so a release is registered once, not in several screens.
export const APP_UPDATES: readonly AppUpdate[] = [
  {
    id: "magalhaes-financeiro-rolagem-2026-11-25",
    title: "Financeiro sem áreas em branco ao rolar",
    date: "2026-11-25",
    preview: "magalhaes-finance-scroll-fix",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "Ao descer até o fim do Painel do Financeiro e voltar a subir, partes da tela às vezes ficavam em branco. O topo fixo (título, botões Nova despesa e Nova receita e abas) agora tem fundo sólido, e a página é desenhada por inteiro durante a rolagem.",
    ],
  },
  {
    id: "magalhaes-lixeira-propostas-2026-11-23",
    title: "Lixeira de propostas ligada ao CRM",
    date: "2026-11-23",
    preview: "magalhaes-proposal-trash",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "Excluir uma proposta agora manda ela para a Lixeira, na nova aba Propostas, e tira o lead dela do CRM. Excluir o lead no CRM também manda a proposta para a Lixeira.",
      "Na Lixeira, Restaurar traz a proposta e o lead de volta, na mesma coluna do CRM. Excluir de vez apaga os dois.",
      "Proposta que já gerou Contas a receber continua sem poder ser excluída, nem por Propostas nem pelo lead no CRM.",
    ],
  },
  {
    id: "crm-colunas-livres-2026-11-23",
    title: "CRM com colunas livres e leads vindos das propostas",
    date: "2026-11-23",
    preview: "crm-free-columns",
    audience: "all",
    workspaces: ["consultoria", "marketing"],
    details: [
      "O botão Nova coluna cria uma etapa com nome e cor. No lápis de cada coluna dá para renomear, mudar a posição ou excluir.",
      "Ao excluir uma coluna com leads, você escolhe para qual coluna eles vão. Nenhum lead é apagado.",
      "Contrato fechado é a coluna fixa do fim do funil: não pode ser renomeada, movida nem excluída, e é ela que o relatório conta como contrato fechado.",
      "O lead não é mais cadastrado à mão: ele nasce da proposta criada em Propostas. Clicar no lead abre a proposta, com os mesmos botões de Propostas para administradores, e a coluna do lead.",
    ],
  },
  {
    id: "magalhaes-filtro-plano-de-contas-2026-11-23",
    title: "Filtro por plano de contas e centro de custo",
    date: "2026-11-23",
    preview: "magalhaes-finance-plan-filter",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "Em Lançamentos, o filtro Categoria virou Plano de contas e mostra todas as contas, separadas em Receitas e Despesas. Ao escolher uma conta de despesa estando em Contas a receber, a lista passa sozinha para Contas a pagar, e vice-versa.",
      "O filtro Centro de custo mostra todos os centros cadastrados, não só os usados no tipo de lançamento aberto. A busca continua encontrando lançamentos pela conta do plano e pelo centro de custo.",
    ],
  },
  {
    id: "magalhaes-finance-shortcuts-2026-11-23",
    title: "Nova receita e nova despesa sempre à mão",
    date: "2026-11-23",
    preview: "magalhaes-finance-shortcuts",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "No Financeiro, o título, os botões Nova despesa e Nova receita e as abas ficam fixos no topo enquanto você rola a lista de lançamentos. Não é mais preciso subir a página para lançar.",
      "Atalhos de teclado: R abre Nova receita e D abre Nova despesa, em qualquer aba do Financeiro. Eles não funcionam enquanto você digita em um campo ou com uma janela aberta, para não atrapalhar.",
    ],
  },
  {
    id: "claude-le-pdf-escaneado-2026-11-23",
    title: "O Claude lê PDFs escaneados",
    date: "2026-11-23",
    preview: "claude-reads-scanned-files",
    audience: "all",
    workspaces: ["consultoria", "marketing"],
    details: [
      "PDFs escaneados ou fotografados (scanner, WhatsApp) agora chegam ao Claude: cada página digitalizada vai como imagem, e ele lê o conteúdo, inclusive documentos datilografados. Páginas com texto continuam indo como texto, e PDFs longos são lidos em partes de 20 páginas.",
      "O Claude também passa a ver os arquivos anexados nas subtarefas e na conversa do processo, além dos arquivos do cliente. Ele abre arquivos ZIP e lê o que há dentro, e o limite por arquivo subiu de 8 para 15 MB.",
      "Em poucos casos o Claude ainda vai pedir um print ou JPG: plantas de CAD, páginas preto e branco de scanner gravadas em formato especial, fotos acima de 5 MB dentro do PDF e arquivos 7z.",
    ],
  },
  {id: "magalhaes-task-list-actions-2026-11-18", title: "Status, prioridade e arquivos na lista", date: "2026-11-18", preview: "magalhaes-task-list-actions", audience: "admin", workspaces: ["consultoria"], details: ["Altere o status/coluna e a prioridade diretamente na lista de processos. A conclusão mantém a conferência de subtarefas e a data de conclusão.", "Arquivos do cliente fica no topo da lista e do calendário. Administradores, incluindo Ana, veem todos os remetentes por padrão e podem filtrar por usuário."]},
  {id: "magalhaes-client-tabs-2026-11-18", title: "Ficha de clientes simplificada", date: "2026-11-18", preview: "magalhaes-client-tabs", audience: "admin", workspaces: ["consultoria"], details: ["As seções Sistemas, Outras unidades e Departamentos foram retiradas da ficha de clientes da Magalhães. O atalho Sistemas e senhas também foi removido do painel do calendário."]},
  {id: "magalhaes-client-directory-2026-11-18", title: "Clientes abre os cadastros", date: "2026-11-18", preview: "magalhaes-client-directory", audience: "admin", workspaces: ["consultoria"], details: ["O menu Clientes agora abre diretamente a lista de cadastros, com busca, filtros e ações de gerenciamento."]},
  {id: "magalhaes-reconciliation-guide-2026-11-18", title: "Conciliação em três passos", date: "2026-11-18", preview: "magalhaes-reconciliation-guide", audience: "admin", workspaces: ["consultoria"], details: ["Escolha uma movimentação no extrato e indique se o lançamento está em aberto, já foi recebido/pago ou ainda não existe.", "Para lançamentos em aberto, escolha o registro e confira o resumo com os dois lados e o saldo restante antes de confirmar. Pagamentos já registrados têm um caminho separado para evitar uma nova baixa."]},
  { id: "magalhaes-finance-month-2026-11-18", title: "Lançamentos por mês", date: "2026-11-18", preview: "magalhaes-finance-month", audience: "admin", workspaces: ["consultoria"], details: ["Selecione o mês e o ano no filtro Mês de vencimento para consultar receitas e despesas do mês inteiro. As datas inicial e final são preenchidas automaticamente e continuam disponíveis para períodos personalizados.", "Os totais, a lista e as exportações acompanham o período selecionado. Limpar filtros retorna à consulta de todo o período."] },
  {
    id: "magalhaes-finance-export-2026-11-18",
    title: "Filtros financeiros, Excel e PDF",
    date: "2026-11-18",
    preview: "magalhaes-finance-export",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "Busque lançamentos por texto, cliente, vencimento, categoria, centro de custo, situação e faixa de valor. Limpe todos os filtros com um clique.",
      "Exporte tabelas e indicadores financeiros para Excel ou imprima e salve em PDF. As tabelas exportam os dados exibidos, respeitando filtros e página.",
      "Em Contas e extratos, a exportação superior busca todas as páginas do mês no filtro selecionado e inclui o saldo atual com a data da consulta. O saldo atual é diferente do saldo de fechamento do mês.",
      "O histórico do Conta Azul é uma importação de arquivos, sem sincronização automática. Atualizar extrato consulta o Sicoob diretamente.",
    ],
  },
  {
    id: "magalhaes-bank-reconciliation-2026-11-17",
    title: "Conciliação bancária e financeiro mais amplo",
    date: "2026-11-17",
    preview: "magalhaes-bank-reconciliation",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "A nova aba Conciliação bancária compara o extrato Sicoob com os lançamentos em aberto. Filtre por mês ou dia e veja pendentes ou conciliadas.",
      "Confira as sugestões por valor e vencimento, confirme a baixa total ou parcial de um lançamento existente, vincule uma baixa já registrada ou cadastre o lançamento que falta. Nenhum pagamento é executado no banco.",
      "O financeiro usa a largura disponível. A lista de lançamentos ajusta textos e colunas sem rolagem horizontal e se reorganiza em blocos em telas menores.",
      "Nova receita e Nova despesa oferecem Avulso, Parcelado e Recorrente separadamente. Parcelado divide o total; Recorrente repete o valor por ocorrência.",
    ],
  },
  {
    id: "magalhaes-finance-recurrence-2026-11-17",
    title: "Receitas e despesas recorrentes",
    date: "2026-11-17",
    preview: "magalhaes-finance-recurrence",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "Em Nova receita ou Nova despesa, escolha Recorrente. O valor informado se repete integralmente em cada ocorrência, sem ser dividido em parcelas.",
      "Escolha frequência semanal, a cada 14 dias, mensal, trimestral ou anual. Termine por quantidade ou data, com até 120 ocorrências, e confira os vencimentos e o total na prévia.",
      "Ao salvar, todas as ocorrências do período entram em Contas a receber ou Contas a pagar. A competência acompanha a frequência. O cadastro não paga contas nem emite boletos automaticamente.",
    ],
  },
  {
    id: "magalhaes-contaazul-history-2026-11-17",
    title: "Histórico financeiro do Conta Azul",
    date: "2026-11-17",
    preview: "magalhaes-contaazul-history",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "Lançamentos, parcelas, pagamentos e recebimentos do Conta Azul estão no Financeiro, com categorias, centros de custo e transferências entre contas.",
      "As baixas preservam o principal, juros, multa e desconto. Os indicadores de recebidos e pagos incluem pagamentos parciais e mostram o dinheiro efetivamente movimentado.",
      "Os detalhes mostram a origem e permitem vincular o cliente correto. As marcações de conciliação da origem foram preservadas; os vínculos com o extrato atual precisam ser conferidos e confirmados na aba Sicoob.",
      "A conciliação aceita também transferências entre contas, incluindo aplicações e resgates. Na lista financeira, Anexos abre uma área para arrastar arquivos, revisar a seleção, anexar, visualizar PDFs e imagens e baixar documentos (até 2 MB por arquivo). A coleta da origem está limitada aos comprovantes de novembro.",
    ],
  },
  {
    id: "crm-relatorio-comercial-2026-11-17",
    title: "Relatório comercial no CRM",
    date: "2026-11-17",
    preview: "crm-commercial-report",
    audience: "all",
    workspaces: ["consultoria", "marketing"],
    details: [
      "A nova aba Relatório do CRM mostra novos leads, taxa de conversão, ticket médio dos leads finalizados e o valor em negociação, com a previsão de fechamento para os próximos 30 dias. Escolha o período: 30 dias, 90 dias, 12 meses ou tudo.",
      "Veja o funil com a quantidade e o valor em cada etapa, o gráfico de leads por mês e a conversão por origem.",
      "Os indicadores do relatório são clicáveis e mostram a lista de leads por trás de cada número.",
      "Em Precisam de atenção aparecem os leads abertos com previsão de fechamento vencida ou sem atualização há 14 dias ou mais. Clique em um lead para abri-lo.",
      "No lead criado por uma proposta, Visualizar abre o PDF dentro do sistema, sem precisar baixar. Em Empresa cadastrada, digite parte do nome para encontrar o cliente; acentos são ignorados.",
    ],
  },
  {
    id: "magalhaes-financeiro-painel-plano-de-contas-2026-11-17",
    title: "Financeiro com painel, plano de contas, relatórios do Sicoob e exclusão de propostas",
    date: "2026-11-17",
    preview: "magalhaes-finance-dashboard",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "O Financeiro abre no novo Painel: saldo consolidado com a evolução de 90 dias, recebido, pago, resultado e inadimplência do mês, gráfico de 6 meses, situação do Sicoob e o que vence nos próximos 7 dias. Clique em qualquer indicador para ver os lançamentos por trás dele.",
      "Receitas não precisam mais de cliente: registre rendimentos, reembolsos e outras entradas como receita avulsa. Despesas não têm campo de cliente. Os botões Nova receita e Nova despesa ficam sempre no topo.",
      "Plano de contas com códigos (como 2.3.01), natureza de receita ou despesa e um plano sugerido para escritório de advocacia. Os centros de custo são escolhidos em lista. Os lançamentos já cadastrados continuam iguais.",
      "Lançamentos ganharam abas-resumo clicáveis (Vencidos, Vencem hoje, A vencer, Recebidos ou Pagos e Total) e tabela em formato de planilha, com conta do plano, centro de custo e totais.",
      "Extrato, Sicoob e Contas viraram uma única aba, Contas e extratos: escolha a conta para ver o extrato com saldo acumulado. Na conta Sicoob, alterne entre o extrato do banco e as baixas no sistema.",
      "Todos os indicadores do Painel, de Contas e extratos e dos Relatórios são clicáveis: abrem um resumo com o cálculo e a lista de registros por trás do número e, quando cabe, um atalho para os lançamentos.",
      "Clique em qualquer movimentação pendente do Sicoob, no extrato ou nos relatórios, para conciliar na hora. Se não houver baixa correspondente, crie a receita ou a despesa ali mesmo, com conta do plano, centro de custo e cliente: o lançamento já fica pago na conta Sicoob e conciliado.",
      "O Detalhe do mês do Sicoob virou uma lista no estilo de extrato bancário, com o histórico legível e o nome de quem pagou ou recebeu. Filtre por Maiores, Para conciliar, Todas ou por tipo de histórico, e clique numa movimentação para ver os detalhes.",
      "Relatórios abrem no Banco Sicoob, com gráfico de entradas e saídas, ticket médio, comparação banco × sistema e pendências de conciliação. O Resultado do escritório traz a DRE gerencial pelo plano de contas, com análise vertical.",
      "Contratos, Serviços, Ordens de serviço e Compras saíram do menu do Financeiro. Os registros existentes foram preservados.",
      "Em Propostas, use Excluir para remover uma proposta que ainda não gerou lançamentos. O lead continua no CRM, sem o PDF da proposta, e a exclusão fica no Histórico. Propostas que já geraram Contas a receber não podem ser excluídas.",
      "Em Propostas, Visualizar abre o PDF dentro do sistema, com opções para baixar ou abrir em nova aba. Os campos de cliente de Propostas e Lançamentos agora aceitam busca: digite parte do nome e escolha com clique ou Enter.",
    ],
  },
  {
    id: "magalhaes-sicoob-boletos-2026-11-17",
    title: "Boletos Sicoob e histórico do extrato",
    date: "2026-11-17",
    preview: "magalhaes-sicoob-boletos",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "A aba Boletos no Financeiro permite registrar a cobrança de um honorário em aberto com cliente, dados do pagador e vencimento hoje ou futuro. A emissão exige confirmação do administrador.",
      "Consulte a situação no Sicoob, copie a linha digitável e baixe o PDF. O sistema não envia a cobrança ao cliente nem marca o honorário como recebido automaticamente.",
      "Uma solicitação por honorário evita duplicações. Se a confirmação do banco falhar, a nova emissão fica bloqueada e é possível localizar a cobrança pelo nosso número, conferindo referência, valor e pagador.",
      "O extrato agora mostra os meses consultados, a data da consulta e os meses em que o banco respondeu sem movimentações. Selecione um mês para consultar os registros retornados pelo Sicoob.",
    ],
  },
  {
    id: "magalhaes-sicoob-2026-11-17",
    title: "Sicoob no financeiro: saldo, extrato e conciliação",
    date: "2026-11-17",
    preview: "magalhaes-sicoob",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "A nova aba Sicoob no Financeiro mostra o saldo informado pelo banco, entradas, saídas e movimentações por mês, com acesso restrito aos administradores.",
      "O mês atual é atualizado automaticamente a cada 30 minutos. Para consultar outro mês, selecione o período e use Atualizar extrato. Repetir a importação preserva os mesmos registros.",
      "Concilie uma movimentação com uma baixa existente da mesma conta, valor e tipo. O sistema registra quem confirmou o vínculo e permite desfazê-lo com motivo, preservando a baixa e o histórico.",
      "A importação não cria baixas automaticamente. Esta entrega consulta a conta corrente; investimentos RDC e emissão de boletos não fazem parte desta atualização.",
    ],
  },
  {
    id: "magalhaes-proposta-mensalidade-2026-11-16",
    title: "Orçamentos agora são Propostas, com assessoria mensal",
    date: "2026-11-16",
    preview: "magalhaes-proposal-retainer",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "A aba Orçamentos passou a se chamar Propostas, com Nova proposta, Salvar proposta, Aprovar e Recusar proposta. As propostas já criadas continuam lá, e o endereço da página é o mesmo.",
      "Na nova proposta há a modalidade Mensalidade. O valor pode ser informado em salários mínimos: o sistema calcula a mensalidade e o PDF informa que ela acompanha o salário mínimo vigente.",
      "Uma proposta pode atender mais de uma empresa ou unidade. Cada uma aparece como contratante no PDF e tem sua linha de assinatura.",
      "No escopo, escreva “Título: descrição” para o nome do serviço sair em destaque, como “Trabalhista: contratações e rescisões”.",
      "Novas seções opcionais: processos judiciais cobrados à parte, com o percentual de êxito de cada um; ampliação opcional, com o novo total por mês; e diferenciais do escritório, com textos padrão da Magalhães para usar ou editar.",
      "O PDF também traz a cidade da proposta e o endereço, os contatos e a assinatura da Dra. Ana Paula Magalhães.",
    ],
  },
  {
    id: "crm-ordem-das-colunas-2026-11-10",
    title: "Escolha a ordem das colunas do CRM",
    date: "2026-11-10",
    preview: "crm-column-order",
    audience: "all",
    workspaces: ["consultoria", "marketing"],
    details: [
      "Arraste a coluna pelo título para mudar a posição dela no funil, por exemplo, deixar Novos Leads em primeiro.",
      "No lápis de cada coluna, além do título e da cor, os botões Esquerda e Direita mudam a posição, inclusive no celular.",
      "A ordem vale para todos que usam o CRM no mesmo ambiente. Os leads continuam nas mesmas etapas.",
    ],
  },
  {
    id: "magalhaes-orcamento-proposta-crm-2026-11-10",
    title: "Orçamento vira proposta em PDF e lead no CRM",
    date: "2026-11-10",
    preview: "magalhaes-quote-proposal-crm",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "Orçamentos agora é uma aba própria na barra de cima, ao lado do Financeiro.",
      "O novo orçamento é montado como uma proposta de honorários: objeto, área, escopo, o que não está incluído, valor fixo ou fixo com êxito, parcelas, forma de pagamento e validade.",
      "Baixe a proposta em PDF no timbrado vinho e dourado da Magalhães, com cláusulas, tabela de parcelas e espaço para assinatura.",
      "Ao salvar, o cliente entra como lead em Novos Leads no CRM. Ao abrir o lead, você vê o resumo da proposta e baixa o mesmo PDF.",
      "A proposta pode ser feita para um cliente cadastrado ou para um novo cliente, sem cadastro. Se ela for aprovada, o botão Cadastrar cliente cria o cadastro com os dados da proposta (ou usa um cliente existente) antes de gerar o financeiro.",
      "As seções do Financeiro agora são abas agrupadas em Movimento, Comercial e Gestão e não são mais cortadas em janelas menores.",
    ],
  },
  {
    id: "magalhaes-finance-orders-2026-11-07",
    title: "Serviços e compras ligados ao financeiro",
    date: "2026-11-07",
    preview: "magalhaes-finance-orders",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "Cadastre serviços com preços de referência e organize ordens de serviço e compras com itens, desconto e parcelas.",
      "Acompanhe responsável, início e previsão de entrega, com vínculo ao cliente e ao processo.",
      "Inicie e conclua pedidos antes de gerar contas a receber ou pagar. A geração não duplica parcelas ao repetir a solicitação.",
      "Consulte os detalhes e cancele pedidos com motivo e histórico. Baixas precisam ser estornadas antes do cancelamento.",
    ],
  },
  {
    id: "magalhaes-office-finance-2026-11-07",
    title: "Financeiro com contratos, orçamentos e contas",
    date: "2026-11-07",
    preview: "magalhaes-office-finance",
    audience: "admin",
    workspaces: ["consultoria"],
    details: [
      "Cadastre honorários vinculados a clientes e processos e acompanhe despesas e parcelas.",
      "Gere parcelas de orçamentos aprovados e mensalidades de contratos recorrentes.",
      "Cadastre contas, fornecedores, categorias e centros de custo. Registre baixas e transferências internas.",
      "Edite lançamentos, estorne baixas e consulte extratos, relatórios CSV e histórico.",
    ],
  },
  {
    id: "claude-conectar-e-ler-documentos-2026-10-28", title: "Conecte o Claude em um clique e peça para ler os anexos",
    date: "2026-10-28", preview: "claude-connect-documents", audience: "all", workspaces: ["consultoria", "marketing"],
    details: ["Na área Claude, o botão Conectar meu Claude copia o endereço do conector e abre os conectores do Claude: lá você clica em Adicionar conector personalizado, cola o endereço e entra com o seu próprio login do TaskFlow. O passo a passo completo continua logo abaixo.", "O Claude agora lê os arquivos anexados aos cards: PDF (texto de todas as páginas), Word, Excel, PowerPoint, imagens JPG e PNG e mapas KMZ/KML, com os nomes das áreas, os vértices e a área aproximada em hectares.", "PDFs escaneados, sem texto selecionável, são avisados pelo Claude; nesses casos envie um print das páginas importantes."],
  },
  {
    id: "magalhaes-barra-superior-vidro-2026-10-28", title: "Menu no topo e mais espaço para os processos",
    date: "2026-10-28", preview: "magalhaes-top-glass-nav", audience: "all", workspaces: ["consultoria", "marketing"],
    details: ["No computador, o menu lateral virou uma barra no topo, em vidro vinho. O item aberto mostra o nome e o destaque desliza até a tela escolhida; os demais mostram o nome ao passar o mouse.", "A barra mostra o logo completo da Magalhães. A seta no canto (ou Ocultar barra, no menu da sua foto) encolhe a barra até sobrar só uma pílula com o logo no topo; clicar no logo abre a barra de novo. Com a barra encolhida, as setas ← e → do teclado passam para a tela anterior ou seguinte do menu, param na primeira e na última, e o nome da tela aparece em destaque na pílula; as setas continuam normais enquanto você digita ou com uma janela ou menu aberto. A escolha fica salva neste navegador.", "Em Gestão de processos, a busca, Kanban/Lista/Calendário, os filtros e os botões ficam em faixas mais baixas, liberando altura e largura para as colunas, a lista e o calendário. Tema, notificações, novidades e Sair continuam na barra; no celular o menu segue abrindo pela lateral.", "No Kanban, colunas e cards ganharam acabamento em vidro vinho. Acima do quadro há uma barra de rolagem sempre visível (inclusive no Mac), com setas para ir de coluna em coluna e um puxador vinho para arrastar. Os títulos das colunas e os nomes dos clientes não são mais cortados, e todas as colunas começam na mesma altura. Dentro do card, etiquetas, prioridade, prazo, arquivos e responsáveis seguem o mesmo alinhamento, e os botões Concluir, Duplicar e Editar aparecem flutuando ao passar o mouse, sem apertar o título. Ao arrastar, o card se levanta com borda dourada, deixa uma vaga tracejada no lugar e assenta suavemente ao ser solto.", "A janela de editar tarefa ficou mais limpa: título e ações ficam fixos no topo, Salvar e Cancelar fixos no rodapé, os campos seguem uma grade alinhada com rótulos padronizados, e descrição, subtarefas e abas ganharam acabamento mais organizado, sem mudar nenhum campo.", "O botão Pedir ao Claude virou um pequeno círculo de vidro no canto, que mostra o nome ao passar o mouse. O × ao lado o recolhe para a borda da tela, deixando só uma ponta; clique nela para trazê-lo de volta. Ctrl/⌘ + J continua abrindo o pedido."],
  },
  {
    id: "claude-conector-2026-10-24", title: "Conecte o seu Claude ao TaskFlow",
    date: "2026-10-24", preview: "claude-connector", audience: "all", workspaces: ["consultoria", "marketing"],
    details: ["Nova área Claude no menu: cada pessoa conecta a própria assinatura do Claude ao TaskFlow, com o passo a passo, a situação da conexão e a opção de desconectar.", "No Claude, você pode pedir resumos de clientes e tarefas e a leitura dos arquivos anexados. Com a sua aprovação, ele também cria e altera cards, comentários e subtarefas em seu nome.", "Em qualquer tela, o botão Pedir ao Claude (ou Ctrl/⌘ + J) abre o seu Claude em uma nova aba com o pedido que você escrever e o contexto da tela, como o cliente aberto.", "O Claude vê apenas o que você vê no TaskFlow e não exclui nada."],
  },
  {
    id: "magalhaes-gestao-processos-logo-2026-10-21", title: "Gestão de processos e marca mais legível",
    date: "2026-10-21", preview: "magalhaes-process-navigation", audience: "all", workspaces: ["consultoria"],
    details: ["Minhas Tarefas passa a se chamar Gestão de processos no menu e nas permissões de acesso.", "O texto Gestão do escritório foi retirado debaixo do logo. A marca aparece maior no menu aberto e como brasão no menu recolhido, mantendo o desenho original."],
  },
  {
    id: "magalhaes-documentos-sem-backups-2026-10-21", title: "Anexos somente com documentos de trabalho",
    date: "2026-10-21", preview: "magalhaes-clean-documents", audience: "all", workspaces: ["consultoria"],
    details: ["As exportações técnicas Trello-original-cartao não aparecem mais nos anexos das tarefas e dos clientes.", "Os documentos originais continuam disponíveis. As cópias técnicas foram preservadas separadamente no backup privado da migração."],
  },
  {
    id: "magalhaes-anexos-clientes-rapidos-2026-10-21", title: "Documentos mais leves e vinculados ao cliente",
    date: "2026-10-21", preview: "magalhaes-client-files-fast", audience: "all", workspaces: ["consultoria"],
    details: ["A lista de anexos não baixa todos os documentos: o arquivo é carregado ao abrir e as imagens apenas quando entram na tela.", "Documentos maiores são transferidos por partes para respeitar o limite da API.", "Reabrir o mesmo documento reaproveita o carregamento por um curto período, dentro da mesma sessão.", "Os anexos importados também aparecem no cadastro do cliente. O envio de arquivos nas tarefas mantém esse vínculo, inclusive após a sincronização offline."],
  },
  {
    id: "magalhaes-minhas-tarefas-clientes-2026-10-21", title: "Cards dos clientes em Minhas Tarefas",
    date: "2026-10-21", preview: "magalhaes-all-tasks", audience: "all", workspaces: ["consultoria"],
    details: ["O administrador abre Minhas Tarefas mostrando todos os cards, inclusive os que ainda não têm responsável.", "Cada card mantém o cliente vinculado, a descrição, as subtarefas, os comentários históricos e os documentos na aba Arquivos."],
  },
  {
    id: "magalhaes-menu-clientes-ativos-2026-10-21", title: "Menu de clientes somente com ativos",
    date: "2026-10-21", preview: "magalhaes-active-nav", audience: "all", workspaces: ["consultoria"],
    details: ["Clientes arquivados deixam de aparecer nos atalhos do menu lateral, inclusive no celular e no menu recolhido.", "Os cadastros arquivados continuam disponíveis no filtro de inativos da tela Clientes."],
  },
  {
    id: "magalhaes-clientes-unicos-2026-10-21", title: "Clientes sem duplicação automática",
    date: "2026-10-21", preview: "magalhaes-client-single", audience: "all", workspaces: ["consultoria"],
    details: ["Removida a regra herdada que gerava uma cópia de cada cliente no mesmo ambiente.", "Criar ou editar um cliente mantém um único cadastro. Cópias automáticas idênticas e sem vínculos foram arquivadas; os originais foram preservados."],
  },
  {
    id: "magalhaes-tarefas-neon-2026-10-21", title: "Tarefas conectadas ao Neon",
    date: "2026-10-21", preview: "magalhaes-task-neon", audience: "all", workspaces: ["consultoria"],
    details: ["Corrigida a exigência de Supabase ao criar tarefas e rascunhos com responsável.", "Leitura, edição e sincronização das tarefas agora usam o banco selecionado com a sessão autenticada."],
  },
  {
    id: "magalhaes-usuarios-senha-2026-10-21", title: "Crie usuários com senha inicial",
    date: "2026-10-21", preview: "magalhaes-direct-users", audience: "all", workspaces: ["consultoria"],
    details: ["O administrador cria nome, e-mail, senha inicial e permissões em Usuários, sem convite por e-mail.", "Cada usuário pode trocar a própria senha em Personalizar informando a senha atual. O cadastro público está desativado."],
  },
  {
    id: "magalhaes-acesso-senha-2026-10-21", title: "Entrada direta com e-mail e senha",
    date: "2026-10-21", preview: "magalhaes-password", audience: "all", workspaces: ["consultoria"],
    details: ["Entrada sem código de confirmação por e-mail e correção do carregamento das permissões após o login.", "Novos cadastros continuam restritos ao titular e às pessoas autorizadas pelo administrador."],
  },
  {
    id: "magalhaes-neon-2026-10-21", title: "Banco online e acesso por convite",
    date: "2026-10-21", preview: "magalhaes-neon", audience: "all", workspaces: ["consultoria"],
    details: ["Banco Neon independente, com confirmação de e-mail, administrador inicial e convites para novos usuários.", "Cadastros e anexos privados online. Atualizações são consultadas a cada 10 segundos; Google e IA dependem de configuração própria."],
  },
  {
    id: "magalhaes-banco-local-2026-10-20", title: "Ambiente local para testes completos",
    date: "2026-10-20", preview: "magalhaes-local", audience: "all", workspaces: ["consultoria"],
    details: ["Login administrativo e banco Supabase exclusivo neste Mac para cadastrar e testar clientes, tarefas e arquivos.", "Os cadastros locais são preservados entre sessões. Google e IA continuam dependendo das credenciais próprias dos provedores."],
  },
  {
    id: "magalhaes-identidade-2026-10-20", title: "Magalhães Advocacia: ambiente exclusivo",
    date: "2026-10-20", preview: "magalhaes-brand", audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: ["Identidade vinho e dourado com a marca do escritório no acesso, navegação e papel timbrado.", "Cópia independente do Taskfloww, somente com o ambiente da consultoria, instalação própria do Supabase e código disponível para edição local."],
  },
  {
    id: "anexos-visiveis-nas-subtarefas-recolhidas-2026-10-19",
    title: "Anexos visíveis nas subtarefas recolhidas",
    date: "2026-10-19",
    preview: "subtask-attachment-indicator",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "A subtarefa recolhida mostra um indicador com a quantidade de arquivos anexados. A contagem aparece ao abrir a tarefa e acompanha novos anexos e exclusões, inclusive os registrados offline.",
    ],
  },
  {
    id: "miniaturas-dos-arquivos-das-subtarefas-2026-10-19",
    title: "Miniaturas nos arquivos das subtarefas",
    date: "2026-10-19",
    preview: "subtask-file-thumbnails",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "Os arquivos de imagem das subtarefas exibem uma miniatura ao lado do nome. Imagens aguardando envio offline também mostram uma prévia local; outros arquivos mantêm um ícone de documento.",
    ],
  },
  {
    id: "imagens-arrastadas-para-subtarefas-2026-10-19",
    title: "Imagens arrastadas para subtarefas",
    date: "2026-10-19",
    preview: "subtask-dragged-images",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "Arraste uma ou mais imagens para o campo de descrição da subtarefa. Confira as prévias antes de salvar; as imagens passam a aparecer nos arquivos da subtarefa, inclusive quando o envio fica pendente no modo offline.",
    ],
  },
  {
    id: "atualizacao-automatica-segura-2026-10-19",
    title: "Atualização automática do TaskFlow",
    date: "2026-10-19",
    preview: "automatic-safe-update",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "Quando uma nova versão estiver disponível, o TaskFlow avisa e tenta instalá-la automaticamente após um período sem edição. A página só recarrega se não houver editor aberto nem alterações offline pendentes; o botão Atualizar agora continua disponível.",
    ],
  },
  {
    id: "prints-colados-nas-subtarefas-2026-10-19",
    title: "Prints nas subtarefas",
    date: "2026-10-19",
    preview: "subtask-pasted-prints",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "Cole prints com Ctrl+V ou ⌘V na descrição da subtarefa. Veja a prévia antes de salvar; depois, os prints ficam nos arquivos da subtarefa. Arquivos de até 50 MB também podem ser preparados offline para envio ao reconectar.",
    ],
  },
  {
    id: "calendario-dos-clientes-e-referencias-2026-10-16",
    title: "Calendário dos clientes e referências por tópico",
    date: "2026-10-16",
    preview: "client-calendar-references",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "Clique em Clientes para abrir o calendário geral ou use a seta do menu para escolher um cliente. Os cards mostram apenas o título; clique para abrir a tarefa completa.",
      "No calendário de um cliente, consulte cadastro, sistemas e senhas ou referências em um painel lateral. Gerenciar clientes mantém acesso à lista e ao cadastro completo.",
      "A nova aba Referências reúne posts, links, observações e imagens por tópico. Edite uma referência para movê-la entre campanhas ou assuntos do mesmo cliente.",
    ],
  },
  {
    id: "acoes-google-agenda-sem-rolagem-2026-10-15",
    title: "Ações da Google Agenda sem rolagem",
    date: "2026-10-15",
    preview: "agenda-google-compact-actions",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "Os botões Reconectar Google, Desconectar e Sincronizar agora foram compactados para ocupar a mesma linha dentro do cartão, sem barra de rolagem horizontal. Em telas estreitas, o texto pode quebrar dentro dos botões.",
    ],
  },
  {
    id: "conexao-google-agenda-centralizada-2026-10-15",
    title: "Conexão da Google Agenda organizada",
    date: "2026-10-15",
    preview: "agenda-google-connection-layout",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "O cartão de conexão da Google Agenda centraliza o título e a conta conectada. Reconectar Google, Desconectar e Sincronizar agora ficam na mesma linha, com rolagem horizontal em telas estreitas.",
    ],
  },
  {
    id: "periodo-dos-relatorios-centralizado-2026-10-15",
    title: "Período dos Relatórios centralizado",
    date: "2026-10-15",
    preview: "reports-period-layout",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "No cartão de período dos Relatórios, o título e o intervalo analisado ficam centralizados. Início, Fim e Mês vigente aparecem na mesma linha; em telas muito estreitas, a linha pode ser deslizada sem cortar os campos.",
    ],
  },
  {
    id: "clientes-em-dois-cartoes-no-celular-2026-10-15",
    title: "Clientes em dois cartões por linha no celular",
    date: "2026-10-15",
    preview: "mobile-client-cards",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "A lista de clientes mostra dois cartões por linha no celular. Logo, nome, quantidade de tarefas e ações ficam mais próximos; nomes longos quebram de linha e a mensagem de informações ausentes não ocupa espaço no cartão.",
    ],
  },
  {
    id: "indicadores-do-dashboard-em-duas-colunas-2026-10-15",
    title: "Indicadores do Dashboard em duas colunas no celular",
    date: "2026-10-15",
    preview: "dashboard-mobile-metrics",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "No celular, os indicadores do Dashboard aparecem dois por linha, tanto na visão geral quanto na visão individual. O conteúdo dos cartões foi ajustado para caber na largura menor.",
    ],
  },
  {
    id: "indicadores-de-obrigacoes-em-duas-colunas-2026-10-15",
    title: "Indicadores de Obrigações em duas colunas no celular",
    date: "2026-10-15",
    preview: "mobile-obligations-metrics",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "Na página de Obrigações, Atrasadas e Vencem hoje aparecem lado a lado; Próximos 7 dias e Concluídas no mês ocupam a linha seguinte. Os cartões se ajustam para manter os textos legíveis no celular.",
    ],
  },
  {
    id: "barra-de-tarefas-alinhada-no-celular-2026-10-15",
    title: "Controles de tarefas na mesma largura no celular",
    date: "2026-10-15",
    preview: "mobile-task-toolbar",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "Na página de tarefas, a busca, as visualizações, os filtros e os botões de ação ocupam a mesma largura no celular. Os três tipos de visualização e os três recortes de tarefas se distribuem por toda a linha; os botões de ação preenchem duas colunas quando há espaço.",
      "As telas de lista e calendário usam a mesma margem da busca em dispositivos móveis.",
    ],
  },
  {
    id: "filtros-do-dashboard-organizados-2026-10-15",
    title: "Filtros do Dashboard em uma janela",
    date: "2026-10-15",
    preview: "dashboard-filter-panel",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "No Dashboard administrativo, o botão Filtros abre uma janela no celular e no computador. A visualização rápida reúne Vence hoje, Amanhã, Semana, Mês, Atrasadas, Sem prazo, Pendentes, Concluídas e o período personalizado. Limpar filtros retorna à visão de todas as tarefas.",
      "Os filtros podem ser combinados e atualizam os indicadores, gráficos e listas do painel.",
      "Prazos informados somente como data são interpretados no dia correto do fuso local.",
    ],
  },
  {
    id: "grafico-equipe-legivel-2026-10-15",
    title: "Gráfico da equipe mais legível",
    date: "2026-10-15",
    preview: "team-distribution-labels",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "O gráfico Distribuição da equipe mostra uma pessoa por linha, evitando nomes sobrepostos em telas estreitas. Passe sobre a barra para ver o nome completo e clique para abrir a carga da pessoa.",
    ],
  },
  {
    id: "ambientes-compactos-no-celular-2026-10-15",
    title: "Ambientes mais compactos no celular",
    date: "2026-10-15",
    preview: "compact-environments-mobile",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "Na escolha de ambientes, o título, os espaços e os cartões ficaram menores em telas estreitas. Os dois ambientes e seus botões cabem melhor na mesma tela, sem alterar o layout do computador.",
    ],
  },
  {
    id: "animacao-da-barra-lateral-2026-10-15",
    title: "Barra lateral com animação",
    date: "2026-10-15",
    preview: "animated-sidebar",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "Ao expandir ou recolher a barra lateral no computador, a largura e os nomes dos itens mudam suavemente. A marca, os ícones e o destaque do item ativo permanecem alinhados nas duas posições. No celular, o menu desliza ao abrir e fechar.",
    ],
  },
  {
    id: "historico-limitado-a-cinco-atualizacoes-2026-10-15",
    title: "Histórico com as cinco atualizações mais recentes",
    date: "2026-10-15",
    preview: "recent-update-history",
    audience: "all",
    workspaces: ["marketing", "consultoria"],
    details: [
      "O histórico mostra somente as cinco atualizações mais recentes, incluindo esta. As entradas mais antigas foram retiradas do catálogo.",
    ],
  },
];

export function getVisibleAppUpdates(isAdmin: boolean, workspace?: string) {
  return APP_UPDATES.filter(
    (update) =>
      update.workspaces.some((name) => name === workspace) &&
      (update.audience === "all" || isAdmin),
  ).slice(0, 5);
}

export function formatAppUpdateDate(date: string) {
  // Explicit noon avoids moving a date-only release to the previous local day.
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}
