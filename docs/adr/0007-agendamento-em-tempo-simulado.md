# ADR 0007: Agendamento em tempo simulado

- **Status:** Aceita
- **Data:** 2026-10-01

## Contexto

Vários serviços executam tarefas em instantes futuros:

- **Gateway:** expiração de Pix, boletos e autorizações; compensação de boleto; agenda de liquidação; corte dos repasses; retentativas de webhook; simulação do pagador.
- **Banco:** publicação do arquivo de extrato após o horário de corte.
- **Emissor de notas:** processamento assíncrono das notas.
- **Loja:** renovação de assinaturas.
- **Integrações:** polling de notas e busca de arquivos.

O relógio simulado pode saltar no tempo, por exemplo "pular 30 dias" (seção 8 do `project.md`). Os jobs atrasados do BullMQ são agendados no tempo real do Redis, então um salto do relógio não os dispara. Mesmo que disparassem, todos rodariam com o mesmo "agora", o fim do salto, e gravariam datas erradas.

## Decisão

### Tabela de agendamentos

Cada serviço que agenda tarefas mantém uma tabela `scheduled_jobs` no próprio Postgres, com:

- tipo do job;
- `run_at` em tempo simulado;
- payload e status;
- tentativas;
- uma chave de deduplicação, para que agendar a mesma tarefa duas vezes não crie dois jobs.

### Execução

Um agendador em cada serviço observa o relógio simulado e executa o que venceu:

1. Enquanto houver jobs com `run_at` menor ou igual ao instante atual, pega os de menor `run_at`.
2. Envia esses jobs ao BullMQ e espera que terminem.
3. Repete. Jobs criados durante o processamento com `run_at` já vencido entram na mesma passada.

Jobs do mesmo instante podem rodar em paralelo. O instante seguinte só começa depois que o anterior termina. Essa barreira garante, por exemplo, que o repasse do corte do dia 5 só seja fechado depois de tudo que aconteceu até o dia 5.

### O tempo do job

O "agora" de um job é o seu `run_at`, e não o instante atual do relógio. As funções de domínio recebem o instante como parâmetro, e o agendador passa o `run_at`. Um Pix agendado para o dia 3 e processado com o relógio no dia 30 grava `paid_at` no dia 3.

### Marca d'água

Depois de processar tudo até um instante T, o serviço publica T como sua marca d'água no Redis do plano de controle (`sim:watermark:<serviço>`). O orquestrador espera que todas as marcas d'água alcancem o alvo antes de avançar o relógio de novo ou de verificar os resultados de um cenário.

A `libs/sim-clock` passa a oferecer, em cada linguagem, a notificação de avanço do relógio e a publicação da marca d'água. A lógica do agendador fica em cada serviço, porque depende do banco de dados dele.

### Domínios de tempo

| Tempo simulado | Tempo real |
| --- | --- |
| Prazos de negócio, expirações, agenda de liquidação, cortes, retentativas de webhook, comportamento simulado | Timeouts HTTP, rate limit, retentativas técnicas do BullMQ, expiração de URLs pré-assinadas |

O BullMQ continua executando os jobs, com concorrência, retentativas técnicas e observabilidade, mas nunca decide quando uma tarefa de negócio acontece.

## Consequências

### Positivas

- Saltos do relógio processam tudo na ordem certa e com as datas certas.
- O agendamento sobrevive a reinícios, porque a tabela é persistente.
- A marca d'água torna determinístico o momento em que um cenário pode ser verificado.

### Negativas

- É mais complexo do que usar os jobs atrasados do BullMQ.
- A barreira por instante limita a vazão em saltos longos com muitos eventos.
- O agendador precisa ser implementado em cada linguagem.
- Um serviço travado impede o avanço do relógio. O orquestrador precisa de timeout e de um aviso claro de qual serviço não alcançou a marca d'água.
