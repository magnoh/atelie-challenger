# Publicar na EC2 do zero

Uma EC2 com Docker: aplicação e PostgreSQL do projeto, mais Caddy para receber HTTP/HTTPS. Sem RDS, balanceador ou Kubernetes. **Os arquivos foram preparados, mas nenhuma instância AWS foi criada e este deploy ainda não foi executado.**

## 1. Criar a instância no console AWS

Em EC2 → Instâncias → Executar instâncias:

| Campo | Configuração |
| --- | --- |
| Nome | `atelie-leiloes` |
| Imagem | Ubuntu Server **24.04 LTS**, oficial da Canonical |
| Arquitetura | x86_64 |
| Tipo sugerido | `t3.micro` (1 GiB de RAM), marcada como elegível na conta; opção escolhida para economizar os créditos do Free Tier |
| Créditos de CPU | Em detalhes avançados, selecione `Standard` para não usar créditos excedentes de CPU cobrados no modo Unlimited |
| Armazenamento | 20 GiB, gp3, criptografado |
| Par de chaves | Crie ou selecione um par; guarde a chave privada no seu computador |
| Rede | VPC com subnet pública, rota para Internet Gateway e IPv4 público habilitado |
| IAM role | Nenhuma é necessária para esta aplicação |

O usuário informou US$ 100 de créditos disponíveis. Confira o prazo e o saldo em Billing → Free Tier e confirme se a conta está no plano gratuito. O uso de EC2, EBS e IPv4 público consome os créditos conforme as regras da conta; a indicação “Free tier eligible” não significa uso ilimitado. No plano gratuito novo, a duração é de até seis meses ou até o fim dos créditos, o que ocorrer primeiro. A escolha de região fica a seu critério; mantenha os recursos na mesma região. Referência: [Free Tier para EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html).

A `t3.micro` tem 1 GiB de RAM e é uma opção econômica para testar este projeto, mas não há garantia de desempenho. O modo Standard pode limitar a CPU quando os créditos acabarem; isso evita cobranças de créditos excedentes de CPU do Unlimited, não o custo normal da instância. Referência: [créditos e modo das instâncias burstable](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html).

No Security Group, configure as entradas:

| Tipo | Porta TCP | Origem |
| --- | --- | --- |
| SSH | 22 | Seu IP público, `/32` (opção “Meu IP”) |
| HTTP | 80 | `0.0.0.0/0` |
| HTTPS | 443 | `0.0.0.0/0` |

Não abra 5432 nem 3001 para a internet. O banco não publica portas; a porta 3001 só fica em loopback. Deixe a saída padrão habilitada para baixar imagens, consultar a API pública e emitir certificados.

Referências oficiais: [Security Groups da EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating-security-group.html) e [conexão à instância](https://docs.aws.amazon.com/us_en/AWSEC2/latest/UserGuide/connect.html).

## 2. Conectar

Espere a EC2 ficar em execução e os checks de status passarem. No terminal do Ubuntu/WSL do seu computador:

```sh
chmod 400 ~/caminho/sua-chave.pem
ssh -i ~/caminho/sua-chave.pem ubuntu@IP_PUBLICO_DA_EC2
```

Substitua o caminho da chave e o IP. No PowerShell com OpenSSH, use o caminho Windows da chave e o mesmo usuário `ubuntu`.

## 3. Levar o projeto para o servidor

Se o repositório já estiver publicado no GitHub, na EC2:

```sh
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git challenger-leilao
cd challenger-leilao
```

Substitua a URL pelo repositório real. Não existe um repositório público criado automaticamente por estes arquivos.

Se ainda não houver GitHub, envie os fontes pelo Ubuntu/WSL do seu computador:

```sh
cd /mnt/c/Users/Magno/Documents/challenger-leilao
tar --exclude='./node_modules' --exclude='./dist' --exclude='./.git' --exclude='./.env' --exclude='./.env.*' --exclude='./.local' --exclude='./tmp' -czf /tmp/challenger-leilao.tar.gz .
scp -i ~/caminho/sua-chave.pem /tmp/challenger-leilao.tar.gz ubuntu@IP_PUBLICO_DA_EC2:~/challenger-leilao.tar.gz
```

Depois, na EC2:

```sh
mkdir -p ~/challenger-leilao
tar -xzf ~/challenger-leilao.tar.gz -C ~/challenger-leilao
cd ~/challenger-leilao
```

Esse envio leva somente os fontes: banco e chave de auditoria do ambiente local não são migrados. O Docker criará uma nova demonstração na EC2.

## 4. Instalar Docker

Na pasta do projeto na EC2:

```sh
sudo bash deploy/ec2/setup-ubuntu.sh
```

O script usa o repositório oficial do Docker e instala Docker Engine e o plugin Compose, seguindo a [documentação para Ubuntu](https://docs.docker.com/engine/install/ubuntu/). O uso de `sudo docker` nos passos seguintes evita precisar adicionar seu usuário ao grupo Docker.

### Memória durante o build na t3.micro

Confira a memória e o swap:

```sh
free -h
swapon --show
```

Se a compilação falhar por falta de memória e esta EC2 nova ainda não tiver swap nem um arquivo `/swapfile`, adicione 2 GiB no disco EBS existente:

```sh
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
printf '/swapfile none swap sw 0 0\n' | sudo tee -a /etc/fstab
```

Execute essa sequência apenas uma vez. Swap usa espaço e operações no EBS e é mais lento que RAM; ajuda na compilação, mas não aumenta a capacidade física da instância.

## 5. Configurar e subir pelo IP

```sh
cp deploy/ec2/env.example .env.ec2
chmod 600 .env.ec2
openssl rand -hex 24
nano .env.ec2
```

Copie a senha hexadecimal gerada para `DB_PASSWORD` e informe o IP público em `APP_ORIGIN`. Para o primeiro acesso por IP, mantenha:

```dotenv
SITE_ADDRESS=:80
APP_ORIGIN=http://IP_PUBLICO_DA_EC2
APP_ENV=development
```

`development` aqui permite o cookie de sessão via HTTP; o processo executa a aplicação já compilada, sem Vite ou watcher. Use somente dados simulados nessa demonstração HTTP. Para usar HTTPS com domínio, veja o passo 7.

Suba os containers:

```sh
sudo docker compose --env-file .env.ec2 -f compose.yaml -f compose.ec2.yaml up --build -d
sudo docker compose --env-file .env.ec2 -f compose.yaml -f compose.ec2.yaml ps
sudo docker compose --env-file .env.ec2 -f compose.yaml -f compose.ec2.yaml logs -f app
```

Ctrl+C sai dos logs e mantém os containers em execução. Quando `app` estiver saudável, abra **http://IP_PUBLICO_DA_EC2**. Migração e seed são automáticos. O Caddy só inicia depois que a aplicação fica saudável; o banco precisa ficar saudável antes da aplicação.

Os dois arquivos `-f` e o `--env-file .env.ec2` devem ser usados juntos também nos comandos de manutenção. Não use apenas `docker compose up` nessa EC2, pois isso aplicaria a configuração local.

## 6. Conferir

```sh
curl -fsS http://localhost/api/health
```

Deve retornar `{"ok":true}`. Teste no navegador:

- Entrar como `ana@demo.com`, senha `Verzel2026!` (ou a definida antes do primeiro seed).
- Ver imagens dos lotes, carteira e arremate já semeado.
- Em outro perfil de navegador, entrar como `bruno@demo.com` e dar um lance.
- Abrir o comprovante e a auditoria sem login.

Se houver erro, veja os logs de `app`, `db` e `proxy`. O primeiro build Docker ainda precisa ser validado nesse servidor; a sessão de desenvolvimento não teve acesso ao Docker/WSL para executá-lo.

## 7. HTTPS quando houver domínio

Crie um registro DNS **A** do domínio/subdomínio apontando para o IPv4 público da EC2. Um Elastic IP é uma opção para mantê-lo estável; confira a cobrança da AWS antes de alocar. Sem IP estável, confira o novo IP após parar/iniciar a EC2 e atualize DNS e `APP_ORIGIN` se ele mudar.

Quando o DNS estiver apontando corretamente, altere `.env.ec2`:

```dotenv
SITE_ADDRESS=leilao.seudominio.com
APP_ORIGIN=https://leilao.seudominio.com
APP_ENV=production
```

Reaplique sem apagar volumes:

```sh
sudo docker compose --env-file .env.ec2 -f compose.yaml -f compose.ec2.yaml up -d
```

Com as portas 80/443 acessíveis e o DNS correto, o Caddy provisiona e renova o certificado e redireciona HTTP para HTTPS. O app passa a enviar cookies Secure. O proxy mantém os eventos de lances sem buffering. Referências: [HTTPS automático](https://caddyserver.com/docs/automatic-https) e [reverse proxy do Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

## Manutenção e persistência

Os containers reiniciam com o Docker após reiniciar a EC2. Banco, chave de auditoria e certificados ficam em volumes no disco EBS. O banco e a chave precisam ser preservados juntos; mudar apenas a chave invalida a auditoria anterior. Mantenha também o arquivo `.env.ec2`, pois o PostgreSQL não troca a senha de um banco já existente só por mudar `DB_PASSWORD` no arquivo.

Para parar sem apagar os dados:

```sh
sudo docker compose --env-file .env.ec2 -f compose.yaml -f compose.ec2.yaml down
```

Não use `down -v` se quiser manter os dados. A persistência no EBS não substitui backup: apagar a instância pode apagar o disco conforme a opção “Delete on termination”. O projeto é uma demonstração em servidor único, sem alta disponibilidade.
