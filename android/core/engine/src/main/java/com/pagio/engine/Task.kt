package com.pagio.engine

import java.util.concurrent.CancellationException

/**
 * Contexte d'exécution d'un traitement : remonte la progression (0..1) et permet l'annulation.
 * Les fonctions du moteur sont bloquantes : appelez-les depuis Dispatchers.IO.
 */
class TaskContext(
    private val onProgress: (fraction: Float, message: String?) -> Unit = { _, _ -> },
    private val cancelled: () -> Boolean = { false },
) {
    fun progress(fraction: Float, message: String? = null) {
        checkCancelled()
        onProgress(fraction.coerceIn(0f, 1f), message)
    }

    fun checkCancelled() {
        if (cancelled()) throw CancellationException("Traitement annulé")
    }

    companion object {
        val NONE = TaskContext()
    }
}

/** Codes d'erreur stables, traduits en messages compréhensibles par l'interface. */
enum class EngineError {
    PASSWORD_REQUIRED,
    WRONG_PASSWORD,
    CORRUPTED,
    UNSUPPORTED_FORMAT,
    INVALID_RANGE,
    NO_TEXT,
    EMPTY_INPUT,
    TOO_LARGE,
    NOT_ENCRYPTED,
    NO_SIGNATURE,
    IO,
}

class EngineException(val code: EngineError, message: String, cause: Throwable? = null) :
    Exception(message, cause)
