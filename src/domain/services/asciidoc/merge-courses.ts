import path from 'path'
import fs from 'fs'
import { ATTRIBUTE_CAPTION, ATTRIBUTE_CATEGORIES, ATTRIBUTE_STATUS, ATTRIBUTE_THUMBNAIL, ATTRIBUTE_USECASE, Course } from '../../model/course';
import { DEFAULT_COURSE_STATUS, DEFAULT_COURSE_THUMBNAIL } from '../../../constants'
import { loadFile } from '../../../modules/asciidoc'
import { ATTRIBUTE_ORDER, Module } from '../../model/module';
import { ATTRIBUTE_CYPHER, ATTRIBUTE_DURATION, ATTRIBUTE_SANDBOX, ATTRIBUTE_TYPE, ATTRIBUTE_VERIFY, Lesson, LESSON_TYPE_TEXT } from '../../model/lesson';
import { ATTRIBUTE_ANSWER, Question } from '../../model/question';
import { decode } from 'html-entities'
import { write } from '../../../modules/neo4j';

const loadCourses = (): Course[] => {
    const folder = path.join(__dirname, '..', '..', '..', '..', 'asciidoc', 'courses')
    return fs.readdirSync( folder )
        .map(slug => loadCourse( path.join(folder, slug) ))
}

const loadCourse = (folder: string): Course => {
    const slug = <string> folder.split('/').filter(a => !!a).pop()
    const file = loadFile(path.join(folder, 'overview.adoc'))

    const moduleDir = path.join(folder, 'modules')
    const modules = fs.existsSync(moduleDir)
        ? fs.readdirSync(moduleDir)
            .filter(slug => fs.existsSync(path.join(moduleDir, slug, 'overview.adoc')))
            .map(slug => loadModule(path.join(folder, 'modules', slug)))
        : []

    const categories = file.getAttribute(ATTRIBUTE_CATEGORIES, '').split(',').filter((e: string) => e !== '')


    console.log(categories);

    return {
        slug,
        title: <string> file.getTitle(),
        status: file.getAttribute(ATTRIBUTE_STATUS, DEFAULT_COURSE_STATUS),
        thumbnail: file.getAttribute(ATTRIBUTE_THUMBNAIL, DEFAULT_COURSE_THUMBNAIL),
        caption: file.getAttribute(ATTRIBUTE_CAPTION, null),
        usecase: file.getAttribute(ATTRIBUTE_USECASE, null),
        categories,
        modules,
    }
}

const loadModule = (folder: string): Module => {
    const slug = <string> folder.split('/').filter(a => !!a).pop()
    const file = loadFile(path.join(folder, 'overview.adoc'))

    const lessonsDir = path.join(folder, 'lessons')

    const lessons = fs.existsSync(lessonsDir)
        ? fs.readdirSync(lessonsDir)
            .filter(file => fs.lstatSync(path.join(lessonsDir, file)).isDirectory() && fs.existsSync(path.join(lessonsDir, file, 'index.adoc')))
            .map(filename => loadLesson(path.join(lessonsDir, filename)))
            .sort((a, b) => a.order > b.order ? -1 : 1)
        : []

    return {
        path: path.join(folder, 'index.adoc'),
        slug,
        title: <string> file.getTitle(),
        order: file.getAttribute(ATTRIBUTE_ORDER, null),
        lessons,
    }
}

const loadLesson = (folder: string): Lesson => {
    const slug = <string> folder.split('/').filter(a => !!a).pop()!
    const file = loadFile(path.join(folder, 'index.adoc'))

    // Load questions and answers into database

    const questionsDir = path.join(folder, 'questions')
    const questions = fs.existsSync( questionsDir ) ?
        fs.readdirSync(questionsDir)
            .filter(file => file.endsWith('.adoc'))
            .map(filename => loadQuestion(path.join(questionsDir, filename)))
        : []

    return {
        path: folder,
        slug,
        title: file.getTitle(),
        type: file.getAttribute(ATTRIBUTE_TYPE, LESSON_TYPE_TEXT),
        order: file.getAttribute(ATTRIBUTE_ORDER, null),
        duration: file.getAttribute(ATTRIBUTE_DURATION, null),
        sandbox: file.getAttribute(ATTRIBUTE_SANDBOX, null),
        cypher: decode(file.getAttribute(ATTRIBUTE_CYPHER, null)),
        answer: decode(file.getAttribute(ATTRIBUTE_ANSWER, null)),
        verify: decode(file.getAttribute(ATTRIBUTE_VERIFY, null)),
        questions,
    } as Lesson
}

const generateQuestionId = (title: string): string => {
    return '_'+ title.replace(/(<([^>]+)>)/gi, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/_+$/g, '')
}

const loadQuestion = (filepath: string): Question => {
    const file = loadFile(filepath)

    const id = file.getAttribute('id', generateQuestionId(file.getTitle()!))

    return {
        id,
        text: file.getTitle(),
    } as Question

}

export async function mergeCourses(): Promise<void> {
    const courses = loadCourses()

    await write(`
        UNWIND $courses AS course
        MERGE (c:Course {slug: course.slug })
        SET
            c.id = apoc.text.base64Encode(course.slug),
            c.title = course.title,
            c.thumbnail = course.thumbnail,
            c.caption = course.caption,
            c.status = course.status,
            c.usecase = course.usecase,
            c.updatedAt = datetime()

        // Assign Categories
        FOREACH (r in [ (c)-[r:IN_CATEGORY]->() | r] | DELETE r)

        FOREACH (category IN course.categories |
            MERGE (ct:Category {id: apoc.text.base64Encode(category)})
            MERGE (c)-[:IN_CATEGORY]->(ct)
        )

        // Set old modules to "deleted"
        FOREACH (m IN [ (c)-[:HAS_MODULE]->(m) | m ] |
            SET m:DeletedModule
        )

        FOREACH (r IN [ (m)-[r:HAS_MODULE|FIRST_MODULE]->() | r ] |
            DELETE r
        )

        WITH c, course

        UNWIND course.modules AS module
        MERGE (m:Module {id: apoc.text.base64Encode(course.slug +'--'+ module.slug) })
        SET
            m.title = module.title,
            m.slug = module.slug,
            m.order = toInteger(module.order),
            m.status = 'active',
            m.duration = module.duration,
            m.updatedAt = datetime()

        // Restore current modules
        REMOVE m:DeletedModule

        MERGE (c)-[:HAS_MODULE]->(m)

        // Delete Next Module
        FOREACH (r IN [ (m)-[r:NEXT_MODULE]-() | r ] | DELETE r)

        // Set old lessons to "deleted"
        FOREACH (l IN [ (m)-[:HAS_LESSON]->(l) | l ] |
            SET l:DeletedLesson
        )

        // Detach old lessons
        FOREACH (r IN [ (m)-[r:HAS_LESSON|FIRST_LESSON|LAST_LESSON]->() | r ] |
            DELETE r
        )

        WITH m, c, course, module
        UNWIND module.lessons AS lesson
        MERGE (l:Lesson {id: apoc.text.base64Encode(course.slug +'--'+ module.slug +'--'+ lesson.slug) })
        SET
            l.slug = lesson.slug,
            l.type = lesson.type,
            l.title = lesson.title,
            l.order = toInteger(lesson.order),
            l.duration = lesson.duration,
            l.sandbox = lesson.sandbox,
            l.cypher = lesson.cypher,
            l.verify = lesson.verify,
            l.status = 'active',
            l.updatedAt = datetime()

        REMOVE l:DeletedLesson

        MERGE (m)-[:HAS_LESSON]->(l)

        FOREACH (r IN [ (l)-[r:NEXT_LESSON]-() | r ] | DELETE r)


        // Load Questions
        FOREACH (q IN [ (l)-[:HAS_QUESTION]->(q) | q ] |
            SET q:DeletedQuestion
        )

        FOREACH (r IN [ (l)-[r:HAS_QUESTION]->() | r ] |
            DELETE r
        )

        FOREACH (question IN lesson.questions |
            MERGE (q:Question {id: apoc.text.base64Encode(l.id +'--'+ question.id)})
            SET q.slug = question.id, q.text = question.text
            REMOVE q:DeletedQuestion
            MERGE (l)-[:HAS_QUESTION]->(q)
        )

        WITH c, m, l ORDER BY l.order ASC
        WITH c, m, collect(l) AS lessons
        CALL apoc.nodes.link(lessons, 'NEXT_LESSON')

        WITH c, m, lessons, lessons[0] as first, lessons[ size(lessons)-1 ] AS last
        MERGE (m)-[:FIRST_LESSON]->(first)
        MERGE (m)-[:LAST_LESSON]->(last)

        WITH c, m ORDER BY m.order ASC
        WITH c, collect(m) AS modules

        CALL apoc.nodes.link(modules, 'NEXT_MODULE')


        WITH c
        MATCH (c)-[:HAS_MODULE]->(m)-[:LAST_LESSON]->(last),
            (m)-[:NEXT_MODULE]->()-[:FIRST_LESSON]->(next)

        MERGE (last)-[:NEXT_LESSON]->(next)



        RETURN count(*) AS count

    `, { courses })

    console.log(`📚 ${courses.length} Courses merged into graph`);
}