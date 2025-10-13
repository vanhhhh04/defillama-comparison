# Coins server

For usage: https://defillama.com/docs/api
For contributions: https://docs.llama.fi/coin-prices-api
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.nvm/nvm.sh

# Install and use Node 20 LTS
nvm install 20
nvm use 20
node -v   # should be v20.x
npm -v    # should be v10.x

cd ~/vah/phoenixunity_project/defillamma/defillamma/coins

rm -rf node_modules package-lock.json
npm cache clean --force


npm ci || npm install

run dyamodb: 
dynamodb_local_latest % java -Djava.library.path=./DynamoDBLocal_lib -jar DynamoDBLocal.jar -sharedDb

docker run --rm --network host amazon/aws-cli \
  dynamodb create-table \
  --table-name prod-coins-table \
  --attribute-definitions AttributeName=PK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH \
  --billing-mode PAYPERREQUEST \
  --endpoint-url http://localhost:8000 \
  --region us-east-1

ubuntu
$AWS dynamodb create-table \
  --table-name prod-coins-table \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5
$AWS dynamodb list-tables
docker run --rm --network host \
  -e AWS_ACCESS_KEY_ID=fakeid \
  -e AWS_SECRET_ACCESS_KEY=fakesecret \
  amazon/aws-cli dynamodb create-table \
  --table-name prod-coins-table \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=N \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
  --endpoint-url http://localhost:8000 \
  --region us-east-1

An error occurred (ResourceInUseException) when calling the CreateTable operation: Cannot create preexisting table
anhcao_phoenixunity@MacBook-Pro-cua-Anhcao-phoenixunity ~ % docker run --rm --network host \
  -e AWS_ACCESS_KEY_ID=fakeid \
  -e AWS_SECRET_ACCESS_KEY=fakesecret \
  amazon/aws-cli dynamodb list-tables \
  --endpoint-url http://localhost:8000 \
  --region us-east-1
{
    "TableNames": [
        "prod-coins-table"
    ]
}
anhcao_phoenixunity@MacBook-Pro-cua-Anhcao-phoenixunity ~ % docker run --rm --network host \
  -e AWS_ACCESS_KEY_ID=fakeid \
  -e AWS_SECRET_ACCESS_KEY=fakesecret \
  amazon/aws-cli dynamodb scan \
  --table-name prod-coins-table \
  --region us-east-1 \
  --endpoint-url http://localhost:8000 \
  --output table
-----------------------------------------------
|                    Scan                     |
+-------------------+--------+----------------+
| ConsumedCapacity  | Count  | ScannedCount   |
+-------------------+--------+----------------+
|  None             |  0     |  0             |
+-------------------+--------+----------------+



get all record follow by table:
docker run --rm --network host \
  -e AWS_ACCESS_KEY_ID=fakeid \
  -e AWS_SECRET_ACCESS_KEY=fakesecret \
  amazon/aws-cli dynamodb scan \
  --table-name prod-coins-table \
  --region us-east-1 \
  --endpoint-url http://localhost:8000 \
  --query "Items[].{PK:PK.S,SK:SK.S,Symbol:symbol.S}" \
  --output table



run redis:
redis-server

run elastics:
docker run -p 9200:9200 -e "discovery.type=single-node" elasticsearch:8.13.4

run fafka: 
kafka-server-start /opt/homebrew/etc/kafka/server.properties


list all coins with their symbols
aws dynamodb scan \
  --table-name prod-coins-table \
  --endpoint-url http://localhost:8000 \
  --region us-east-1 \
  | jq -r '.Items[] | [.PK.S, .symbol.S] | @tsv'

list all recods for bsc chain:


intall ts-node:
npm install --save-dev ts-node 




run file

npx ts-node src/storeCoins.ts