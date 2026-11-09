package com.pagio.engine

import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDDocumentInformation
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import com.tom_roush.pdfbox.pdmodel.interactive.digitalsignature.PDSignature
import com.tom_roush.pdfbox.pdmodel.interactive.digitalsignature.SignatureInterface
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.cert.X509CertificateHolder
import org.bouncycastle.cert.jcajce.JcaCertStore
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.cms.CMSProcessableByteArray
import org.bouncycastle.cms.CMSSignedData
import org.bouncycastle.cms.CMSSignedDataGenerator
import org.bouncycastle.cms.CMSTypedData
import org.bouncycastle.cms.jcajce.JcaSignerInfoGeneratorBuilder
import org.bouncycastle.cms.jcajce.JcaSimpleSignerInfoVerifierBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import org.bouncycastle.operator.jcajce.JcaDigestCalculatorProviderBuilder
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.Calendar
import java.util.Date

data class ProtectOptions(
    val userPassword: String,
    val ownerPassword: String? = null,
    val allowPrint: Boolean = true,
    val allowCopy: Boolean = false,
    val allowModify: Boolean = false,
    val allowAnnotations: Boolean = true,
    val allowFillForms: Boolean = true,
)

data class PdfMetadata(
    val title: String? = null, val author: String? = null, val subject: String? = null,
    val keywords: String? = null, val creator: String? = null, val producer: String? = null,
    val created: Date? = null, val modified: Date? = null,
    val pageCount: Int = 0, val encrypted: Boolean = false, val pdfVersion: Float = 0f,
    val hasXmp: Boolean = false, val hasForms: Boolean = false, val signatures: Int = 0,
    val hasJavaScript: Boolean = false, val fileSize: Long = 0,
)

data class SignatureCheck(
    val signerName: String?, val signDate: Date?, val reason: String?, val location: String?,
    val integrityValid: Boolean, val coversWholeDocument: Boolean, val certificateSubject: String?,
    val certificateIssuer: String?, val selfSigned: Boolean, val certValidAtSigning: Boolean, val message: String,
)

/** Identité de signature numérique (clé + certificat). */
class SigningIdentity(val privateKey: PrivateKey, val chain: List<X509Certificate>) {
    val subject: String get() = chain.first().subjectX500Principal.name

    companion object {
        private val bc = BouncyCastleProvider()

        /** Certificat auto-signé RSA 2048 valable 5 ans, enregistré dans un fichier PKCS#12. */
        fun createSelfSigned(commonName: String, email: String?, p12: File, password: CharArray): SigningIdentity {
            val kpg = KeyPairGenerator.getInstance("RSA").apply { initialize(2048, SecureRandom()) }
            val kp = kpg.generateKeyPair()
            val dn = buildString {
                append("CN=").append(commonName.replace(",", " "))
                if (!email.isNullOrBlank()) append(", E=").append(email)
                append(", O=Pagio (auto-signé)")
            }
            val now = Date()
            val until = Calendar.getInstance().apply { add(Calendar.YEAR, 5) }.time
            val builder = JcaX509v3CertificateBuilder(X500Name(dn), BigInteger(64, SecureRandom()), now, until, X500Name(dn), kp.public)
            val signer = JcaContentSignerBuilder("SHA256withRSA").setProvider(bc).build(kp.private)
            val cert = JcaX509CertificateConverter().setProvider(bc).getCertificate(builder.build(signer))
            val ks = KeyStore.getInstance("PKCS12").apply { load(null, null) }
            ks.setKeyEntry("pagio", kp.private, password, arrayOf(cert))
            p12.parentFile?.mkdirs()
            FileOutputStream(p12).use { ks.store(it, password) }
            return SigningIdentity(kp.private, listOf(cert))
        }

        /** Charge un certificat PKCS#12 (.p12/.pfx), par exemple délivré par une autorité. */
        fun load(p12: File, password: CharArray): SigningIdentity {
            val ks = KeyStore.getInstance("PKCS12")
            try { FileInputStream(p12).use { ks.load(it, password) } } catch (e: Exception) {
                throw EngineException(EngineError.WRONG_PASSWORD, "Certificat illisible ou mot de passe incorrect", e)
            }
            val alias = ks.aliases().toList().firstOrNull { ks.isKeyEntry(it) }
                ?: throw EngineException(EngineError.UNSUPPORTED_FORMAT, "Aucune clé privée dans ce certificat")
            val key = ks.getKey(alias, password) as PrivateKey
            val chain = ks.getCertificateChain(alias).map { it as X509Certificate }
            return SigningIdentity(key, chain)
        }
    }
}

object PdfSecurity {
    private val bc = BouncyCastleProvider()

    fun isEncrypted(file: File): Boolean = try {
        PDDocument.load(file, PagioEngine.memory()).use { it.isEncrypted }
    } catch (_: com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException) { true }

    /** Chiffrement AES-256 avec mot de passe d'ouverture et permissions. */
    fun protect(input: File, opt: ProtectOptions, output: File, password: String? = null): File {
        if (opt.userPassword.length < 4) throw EngineException(EngineError.INVALID_RANGE, "Le mot de passe doit contenir au moins 4 caractères")
        return input.usePdf(password) { doc ->
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            val ap = AccessPermission().apply {
                setCanPrint(opt.allowPrint); setCanPrintFaithful(opt.allowPrint)
                setCanExtractContent(opt.allowCopy); setCanExtractForAccessibility(true)
                setCanModify(opt.allowModify); setCanAssembleDocument(opt.allowModify)
                setCanModifyAnnotations(opt.allowAnnotations); setCanFillInForm(opt.allowFillForms)
            }
            val owner = opt.ownerPassword?.takeIf { it.isNotBlank() } ?: (opt.userPassword + "#" + SecureRandom().nextLong())
            val policy = StandardProtectionPolicy(owner, opt.userPassword, ap).apply { encryptionKeyLength = 256 }
            doc.protect(policy)
            doc.save(output); output
        }
    }

    /** Retire le chiffrement : l'utilisateur doit fournir le mot de passe. */
    fun unlock(input: File, password: String, output: File): File {
        val doc = openPdf(input, password)
        doc.use {
            if (!it.isEncrypted) throw EngineException(EngineError.NOT_ENCRYPTED, "Ce PDF n'est pas protégé")
            it.isAllSecurityToBeRemoved = true
            it.save(output)
        }
        return output
    }

    fun readMetadata(input: File, password: String? = null): PdfMetadata = input.usePdf(password) { doc ->
        val info = doc.documentInformation
        val catalog = doc.documentCatalog
        PdfMetadata(
            title = info.title, author = info.author, subject = info.subject, keywords = info.keywords,
            creator = info.creator, producer = info.producer,
            created = info.creationDate?.time, modified = info.modificationDate?.time,
            pageCount = doc.numberOfPages, encrypted = doc.isEncrypted, pdfVersion = doc.version,
            hasXmp = catalog.metadata != null, hasForms = catalog.acroForm?.fields?.isNotEmpty() == true,
            signatures = runCatching { doc.signatureDictionaries.size }.getOrDefault(0),
            hasJavaScript = catalog.names?.javaScript != null || catalog.cosObject.containsKey(COSName.OPEN_ACTION),
            fileSize = input.length(),
        )
    }

    fun writeMetadata(input: File, meta: PdfMetadata, output: File, password: String? = null): File = input.usePdf(password) { doc ->
        if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
        val info = doc.documentInformation
        info.title = meta.title?.ifBlank { null }; info.author = meta.author?.ifBlank { null }
        info.subject = meta.subject?.ifBlank { null }; info.keywords = meta.keywords?.ifBlank { null }
        info.modificationDate = Calendar.getInstance()
        doc.documentCatalog.metadata = null // évite des métadonnées XMP contradictoires
        doc.save(output); output
    }

    /** Supprime auteur, logiciel, dates, XMP, scripts et pièces jointes cachées. */
    fun stripMetadata(input: File, output: File, password: String? = null): File = input.usePdf(password) { doc ->
        if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
        doc.documentInformation = PDDocumentInformation()
        val catalog = doc.documentCatalog
        catalog.metadata = null
        catalog.cosObject.removeItem(COSName.OPEN_ACTION)
        catalog.cosObject.removeItem(COSName.getPDFName("AA"))
        catalog.names?.let { names ->
            names.cosObject.removeItem(COSName.JAVA_SCRIPT)
            names.cosObject.removeItem(COSName.EMBEDDED_FILES)
        }
        doc.pages.forEach { p -> p.metadata = null; p.cosObject.removeItem(COSName.getPDFName("PieceInfo")) }
        doc.save(output); output
    }

    /** Signature numérique PAdES basique (CMS détaché, SHA-256), enregistrée en mode incrémental. */
    fun signDigitally(
        input: File, identity: SigningIdentity, output: File,
        name: String?, reason: String?, location: String?, password: String? = null,
    ): File {
        val doc = openPdf(input, password)
        doc.use {
            val sig = PDSignature().apply {
                setFilter(PDSignature.FILTER_ADOBE_PPKLITE)
                setSubFilter(PDSignature.SUBFILTER_ADBE_PKCS7_DETACHED)
                this.name = name; this.reason = reason; this.location = location
                signDate = Calendar.getInstance()
            }
            val signer = SignatureInterface { content: InputStream ->
                val gen = CMSSignedDataGenerator()
                val cert = identity.chain.first()
                val contentSigner = JcaContentSignerBuilder("SHA256withRSA").setProvider(bc).build(identity.privateKey)
                gen.addSignerInfoGenerator(
                    JcaSignerInfoGeneratorBuilder(JcaDigestCalculatorProviderBuilder().setProvider(bc).build())
                        .build(contentSigner, cert)
                )
                gen.addCertificates(JcaCertStore(identity.chain))
                val data: CMSTypedData = CMSProcessableByteArray(content.readBytes())
                gen.generate(data, false).encoded
            }
            it.addSignature(sig, signer)
            FileOutputStream(output).use { os -> it.saveIncremental(os) }
        }
        return output
    }

    /** Vérifie l'intégrité de chaque signature (empreinte + signature cryptographique). */
    fun verifySignatures(input: File, password: String? = null): List<SignatureCheck> {
        val bytes = input.readBytes()
        return input.usePdf(password) { doc ->
            val sigs = doc.signatureDictionaries
            if (sigs.isEmpty()) throw EngineException(EngineError.NO_SIGNATURE, "Aucune signature numérique dans ce document")
            sigs.map { sig -> check(sig, bytes) }
        }
    }

    private fun check(sig: PDSignature, file: ByteArray): SignatureCheck {
        return try {
            val contents = sig.getContents(file)
            val signedContent = sig.getSignedContent(file)
            val br = sig.byteRange
            val covers = br.size == 4 && (br[2].toLong() + br[3].toLong()) == file.size.toLong()
            val cms = CMSSignedData(CMSProcessableByteArray(signedContent), contents)
            val signer = cms.signerInfos.signers.first()
            @Suppress("UNCHECKED_CAST")
            val holder = cms.certificates.getMatches(signer.sid as org.bouncycastle.util.Selector<X509CertificateHolder>).first() as X509CertificateHolder
            val cert = JcaX509CertificateConverter().setProvider(bc).getCertificate(holder)
            val valid = signer.verify(JcaSimpleSignerInfoVerifierBuilder().setProvider(bc).build(cert))
            val when_ = sig.signDate?.time
            val certOk = when_ == null || (when_.after(cert.notBefore) && when_.before(cert.notAfter))
            val self = cert.subjectX500Principal == cert.issuerX500Principal
            val msg = when {
                !valid -> "Signature invalide : le document a été modifié ou la signature est corrompue."
                !covers -> "Signature valide, mais le document a été complété après la signature."
                self -> "Signature valide (intégrité vérifiée). Certificat auto-signé : l'identité du signataire n'est pas garantie par une autorité."
                else -> "Signature valide (intégrité vérifiée). La chaîne de confiance vers une autorité n'est pas contrôlée sur l'appareil."
            }
            SignatureCheck(sig.name, when_, sig.reason, sig.location, valid, covers, cert.subjectX500Principal.name,
                cert.issuerX500Principal.name, self, certOk, msg)
        } catch (e: Exception) {
            SignatureCheck(sig.name, sig.signDate?.time, sig.reason, sig.location, false, false, null, null, false, false,
                "Signature illisible : ${e.message}")
        }
    }
}
