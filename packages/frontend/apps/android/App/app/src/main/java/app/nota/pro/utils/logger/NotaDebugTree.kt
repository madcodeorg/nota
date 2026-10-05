package app.nota.pro.utils.logger

import timber.log.Timber

class NotaDebugTree : Timber.DebugTree() {

    override fun createStackElementTag(element: StackTraceElement): String {
        return "Nota:${super.createStackElementTag(element)}:${element.lineNumber}"
    }
}