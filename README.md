# MozCarBusiness 🚗

Marketplace para a compra e venda de **carros em Moçambique**, com vendedores verificados e subscrições **trimestrais**.

- Vendedores registam-se com documentos e selfie; o administrador aprova após o pagamento.
- Cada vendedor escolhe um **pacote** que define a taxa trimestral e o número de publicações.
- As publicações ficam **ocultas da loja** quando o trimestre termina, até renovar.
- O vendedor pode **migrar para um pacote superior** durante o trimestre (paga apenas a diferença).
- Painel de administração completo: aprovação de registos/anúncios, renovação de subscrições, **cadastro e edição de pacotes**, publicidade em slideshow e estatísticas.

## Requisitos

- **Node.js 22.5+** (usa o módulo built-in `node:sqlite` — sem dependência do SQLite externo)
- npm (incluído no Node)

## Instalação e execução

```bash
npm install
npm start          # arranca em http://localhost:3010
```

Comandos úteis:

```bash
npm run dev        # reinicia automaticamente em cada alteração (node --watch)
$env:PORT=8080; npm start   # (Windows PowerShell) usar outra porta
PORT=8080 npm start         # (Linux/macOS) usar outra porta
```

## Primeiro acesso ao painel admin

Aceda a `http://localhost:3010/admin`. Como não existe nenhum administrador, a página pede a criação das primeiras credenciais. As credenciais (e-mail + palavra-passe) são guardadas com hash (`scrypt`) na base de dados local.

> As credenciais de **vendedores** também são guardadas com hash. O vendedor pode trocar a palavra-passe em **Minha Conta ▸ Segurança**.

## Estrutura

```
MozCarBusiness/
├── server.js            # API Express: loja pública, vendedores, admin (pacotes, ads, vendas)
├── db.js                # Base de dados node:sqlite + migrações e seed de pacotes
├── package.json
├── public/              # Frontend estático (servido em /static, no-cache)
│   ├── index.html       # Loja pública (pesquisa por texto, marca, preço, combustível...)
│   ├── registar.html    # Registo do vendedor (documentos + selfie + plano)
│   ├── entrar.html      # Entrada vendedor / primeiro acesso admin
│   ├── conta.html       # Minha Conta (subscrição, renovação, upgrade, segurança)
│   ├── sell.html        # Publicar carro (modal de upgrade ao esgotar o plano)
│   ├── payment.html     # Pagamento M-Pesa/E-Mola (subscrição, renovação, upgrade)
│   ├── admin.html       # Painel do administrador
│   ├── js/              # Lógica dos frontends
│   └── css/style.css
├── data/mozcarbusiness.db   # SQLite local (NÃO versionado)
└── uploads/                  # Fotos de carros, documentos e publicidade (NÃO versionado)
```

## Notas de privacidade

O repositório **não** contém a base de dados (`data/`) nem os ficheiros de upload (`uploads/`), que podem incluir dados pessoais (documentos, selfies) e credenciais. Estão ignorados via `.gitignore`. Cada instalação cria a sua própria base de dados e pacotes padrão ao arrancar.

Licença: MIT (ver `package.json`).