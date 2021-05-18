import 'dotenv/config'
import { Express } from 'express'
import { Driver } from 'neo4j-driver';
import initApp from './app'
import { mergeContent } from './domain/services/merge-content';
import initNeo4j, { close } from './modules/neo4j';

const {
    NEO4J_HOST,
    NEO4J_USERNAME,
    NEO4J_PASSWORD,
    PORT,
} = process.env

console.log(`Connecting to ${NEO4J_HOST} as ${NEO4J_USERNAME}`);

initNeo4j(<string> NEO4J_HOST, <string> NEO4J_USERNAME, <string> NEO4J_PASSWORD)
    .then((driver: Driver) => initApp(driver))
    .then((app: Express) => {
        app.listen(PORT || 3000, () => {
            console.log(`\n\n--\n🚀 Listening on http://localhost:3000\n`);
        })

        mergeContent()
    })
    .catch(e => {
        console.error(e)
        close()
    })
