export type UpdateWorkspace = "marketing" | "consultoria";
export type UpdatePreviewKind =
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
