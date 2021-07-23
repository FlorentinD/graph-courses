import account from './account'
import codeBlocks from './code-blocks'
import copyButtons from './copy-button'
import courseList from './course-list'
import header from './header'
import highlight from './highlight'
import home from './home'
import questions from './questions'
import toggleSandbox from './toggle-sandbox'

window.addEventListener('DOMContentLoaded', () => {
    highlight()
    questions()
    toggleSandbox()
    codeBlocks()
    copyButtons()
    header()

    home()
    courseList()
    account()
})