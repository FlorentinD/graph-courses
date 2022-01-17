import { config } from 'dotenv'
import { Session, Transaction, Record } from 'neo4j-driver'
import { createDriver } from "../modules/neo4j"

config()

const {
    NEO4J_HOST,
    NEO4J_USERNAME,
    NEO4J_PASSWORD,
    COMMUNITY_GRAPH_HOST,
    COMMUNITY_GRAPH_USERNAME,
    COMMUNITY_GRAPH_PASSWORD,
} = process.env

const getLastCertification = async (session: Session) : Promise<string> => {
    const res = await session.readTransaction((tx: Transaction) => tx.run(`MATCH (c:FromCommunityGraph) RETURN max(c.completedAt) AS date`))
    const [ first ] = res.records
    const value = first.get('date')

    return value !== null ? value.toString() : '1970-01-01T00:00:00.555000000Z'
}

const main = async () => {
    [
        'NEO4J_HOST',
        'NEO4J_USERNAME',
        'NEO4J_PASSWORD',
        'COMMUNITY_GRAPH_HOST',
        'COMMUNITY_GRAPH_USERNAME',
        'COMMUNITY_GRAPH_PASSWORD',
    ].forEach(key => {
        if ( process.env[ key ] === undefined )  {
            throw new Error(`Missing key ${key}`)
        }
    })

    // tslint:disable-next-line
    console.log(`Connecting to GraphAcademy at ${NEO4J_HOST}`);
    const ga = await createDriver(NEO4J_HOST!, NEO4J_USERNAME!, NEO4J_PASSWORD!)
    const gaSession = ga.session()

    // tslint:disable-next-line
    console.log(`Connecting to Community Graph at ${COMMUNITY_GRAPH_HOST}`);
    const community = await createDriver(COMMUNITY_GRAPH_HOST!, COMMUNITY_GRAPH_USERNAME!, COMMUNITY_GRAPH_PASSWORD!)
    const communitySession = community.session()

    const lastCertification = await getLastCertification(gaSession)

    // tslint:disable-next-line
    console.log(`\n🔎 Getting certifications since ${lastCertification}`);

    const readRes = await communitySession.readTransaction((tx: Transaction) => tx.run(`
        MATCH (c:Certification)<-[:TOOK]-(u)
        WHERE c.name IN [
            "neo4-3.x-certification-test",
            "neo4j-4.x-certification-test",
            "neo4j-gds-test" ,
            "neo4j-certified-professional"
        ]
        AND exists(c.finished) AND c.passed = true
        AND c.finished >= datetime($lastCertification).epochSeconds

        WITH c, u
        ORDER BY c.finished ASC
        LIMIT 1000

        RETURN
        u.auth0_key AS sub,
        CASE c.name WHEN 'neo4j-gds-test' THEN 'gds-certification' ELSE 'neo4j-certification' END AS slug,
        c {
            .percent,
            .certificatePath,
            completedAt: datetime({epochSeconds: c.finished})
        } AS certification
    `, { lastCertification }))

    const rows = readRes.records.map((row: Record) => row.toObject())

    const writeRes = await gaSession.writeTransaction((tx: Transaction) => tx.run(`
        UNWIND $rows AS row
        MATCH (c:Course {slug: row.slug})

        MERGE (u:User {sub: row.sub})
        ON CREATE SET u.id = randomUuid(),
            u.createdAt = datetime()

        MERGE (e:Enrolment {id: apoc.text.base64Encode(row.slug +'--'+ row.sub)})
        ON CREATE SET e.createdAt = datetime()
        SET e:CompletedEnrolment, e:FromCommunityGraph,
            e += row.certification

        MERGE (u)-[:HAS_ENROLMENT]->(e)
        MERGE (e)-[:FOR_COURSE]->(c)
    `, { rows }))

    // tslint:disable-next-line
    console.log(`🥇 Created ${writeRes.summary.counters.updates().nodesCreated} certificate nodes`)

    await ga.close()
    await community.close()
}


main()
